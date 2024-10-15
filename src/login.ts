import _ from "lodash";
import Bluebird from "bluebird";
import inquirer, { Question } from "inquirer";
import puppeteer, {
  Browser,
  ElementHandle,
  HTTPRequest,
  Page,
} from "puppeteer";
import querystring from "querystring";
import { CLIError } from "./CLIError";
import { awsConfig } from "./awsConfig";
import { paths } from "./paths";
import mkdirp from "mkdirp";
import { parseRolesFromSamlResponse } from "./parseRolesFromSamlResponse";
import { assumeRoleAsync } from "./assumeRole";
import { askUserForRoleAndDurationAsync } from "./askUserForRoleAndDuration";
import { getLoginUrl } from "./getLoginUrl";
import { debug } from "./debug";
import { loadProfile } from "./loadProfile";

const WIDTH = 425;
const HEIGHT = 550;
const DELAY_ON_UNRECOGNIZED_PAGE = 1000;
const MAX_UNRECOGNIZED_PAGE_DELAY = 30 * 1000;

// source: https://docs.microsoft.com/en-us/azure/active-directory/hybrid/how-to-connect-sso-quick-start#google-chrome-all-platforms
const AZURE_AD_SSO = "autologon.microsoftazuread-sso.com";
const AWS_SAML_ENDPOINT = "https://signin.aws.amazon.com/saml";
const AWS_CN_SAML_ENDPOINT = "https://signin.amazonaws.cn/saml";
const AWS_GOV_SAML_ENDPOINT = "https://signin.amazonaws-us-gov.com/saml";

export interface Role {
  roleArn: string;
  principalArn: string;
}

/**
 * To proxy the input/output of the Azure login page, it's easiest to run a loop that
 * monitors the state of the page and then perform the corresponding CLI behavior.
 * The states have a name that is used for the debug messages, a selector that is used
 * with puppeteer's page.$(selector) to determine if the state is active, and a handler
 * that is called if the state is active.
 */
const states = [
  {
    name: "username input",
    selector: `input[name="loginfmt"]:not(.moveOffScreen)`,
    async handler(
      page: Page,
      _selected: ElementHandle,
      noPrompt: boolean,
      defaultUsername: string
    ): Promise<void> {
      const error = await page.$(".alert-error");
      if (error) {
        debug("Found error message. Displaying");
        const errorMessage = await page.evaluate(
          (err) => err.textContent,
          error
        );
        console.log(errorMessage);
      }

      let username;

      if (noPrompt && defaultUsername) {
        debug("Not prompting user for username");
        username = defaultUsername;
      } else {
        debug("Prompting user for username");
        ({ username } = await inquirer.prompt([
          {
            name: "username",
            message: "Username:",
            default: defaultUsername,
          } as Question,
        ]));
      }

      debug("Waiting for username input to be visible");
      await page.waitForSelector(`input[name="loginfmt"]`, {
        visible: true,
        timeout: 60000,
      });

      debug("Focusing on username input");
      await page.focus(`input[name="loginfmt"]`);

      debug("Clearing input");
      for (let i = 0; i < 100; i++) {
        await page.keyboard.press("Backspace");
      }

      debug("Typing username");
      await page.keyboard.type(username);

      await Bluebird.delay(500);

      debug("Waiting for submit button to be visible");
      await page.waitForSelector(`input[type=submit]`, {
        visible: true,
        timeout: 60000,
      });

      debug("Submitting form");
      await page.click("input[type=submit]");

      await Bluebird.delay(500);

      debug("Waiting for submission to finish");
      await Promise.race([
        page.waitForSelector(
          `input[name=loginfmt].has-error,input[name=loginfmt].moveOffScreen`,
          { timeout: 60000 }
        ),
        (async (): Promise<void> => {
          await Bluebird.delay(1000);
          await page.waitForSelector(`input[name=loginfmt]`, {
            hidden: true,
            timeout: 60000,
          });
        })(),
      ]);
    },
  },
  {
    name: "account selection",
    selector: `#aadTile > div > div.table-cell.tile-img > img`,
    async handler(page: Page): Promise<void> {
      debug("Multiple accounts associated with username.");
      const aadTile = await page.$("#aadTileTitle");
      const aadTileMessage = await page.evaluate(
        (element) => element?.textContent,
        aadTile
      );

      const msaTile = await page.$("#msaTileTitle");
      const msaTileMessage = await page.evaluate(
        (element) => element?.textContent,
        msaTile
      );

      if (!aadTileMessage || !msaTileMessage) {
        throw new Error("Unable to parse page");
      }

      const accounts = [
        { message: aadTileMessage, selector: "#aadTileTitle" },
        { message: msaTileMessage, selector: "#msaTileTitle" },
      ];

      let account;
      if (accounts.length === 0) {
        throw new CLIError("No accounts found on account selection screen.");
      } else if (accounts.length === 1) {
        account = accounts[0];
      } else {
        debug("Asking user to choose account");
        console.log(
          "It looks like this Username is used with more than one account from Microsoft. Which one do you want to use?"
        );
        const answers = await inquirer.prompt([
          {
            name: "account",
            message: "Account:",
            type: "list",
            choices: _.map(accounts, "message"),
            default: aadTileMessage,
          } as Question,
        ]);

        account = _.find(accounts, ["message", answers.account]);
      }

      if (!account) {
        throw new Error("Unable to find account");
      }

      debug(`Proceeding with account ${account.selector}`);
      await page.click(account.selector);
      await Bluebird.delay(500);
    },
  },
  {
    name: "passwordless",
    selector: `input[value='Send notification']`,
    async handler(page: Page) {
      debug("Sending notification");
      await page.click("input[value='Send notification']");
      debug("Waiting for auth code");
      await page.waitForSelector(`#idRemoteNGC_DisplaySign`, {
        visible: true,
        timeout: 60000,
      });
      debug("Printing the message displayed");
      const messageElement = await page.$(
        "#idDiv_RemoteNGC_PollingDescription"
      );
      const codeElement = await page.$("#idRemoteNGC_DisplaySign");

      const message = await page.evaluate(
        (element) => element?.textContent,
        messageElement
      );
      console.log(message);
      debug("Printing the auth code");
      const authCode = await page.evaluate(
        (element) => element?.textContent,
        codeElement
      );
      console.log(authCode);
      debug("Waiting for response");
      await page.waitForSelector(`#idRemoteNGC_DisplaySign`, {
        hidden: true,
        timeout: 60000,
      });
    },
  },
  {
    name: "password input",
    selector: `input[name="Password"]:not(.moveOffScreen),input[name="passwd"]:not(.moveOffScreen)`,
    async handler(
      page: Page,
      _selected: ElementHandle,
      noPrompt: boolean,
      _defaultUsername: string,
      defaultPassword: string
    ): Promise<void> {
      const error = await page.$(".alert-error");
      if (error) {
        debug("Found error message. Displaying");
        const errorMessage = await page.evaluate(
          (err) => err.textContent,
          error
        );
        console.log(errorMessage);
        defaultPassword = ""; // Password error. Unset the default and allow user to enter it.
      }

      let password;

      if (noPrompt && defaultPassword) {
        debug("Not prompting user for password");
        password = defaultPassword;
      } else {
        debug("Prompting user for password");
        ({ password } = await inquirer.prompt([
          {
            name: "password",
            message: "Password:",
            type: "password",
          } as Question,
        ]));
      }

      debug("Focusing on password input");
      await page.focus(`input[name="Password"],input[name="passwd"]`);

      debug("Typing password");

      await page.keyboard.type(password);

      debug("Submitting form");
      await page.click("span[class=submit],input[type=submit]");

      debug("Waiting for a delay");
      await Bluebird.delay(500);
    },
  },
  {
    name: "TFA instructions",
    selector: `#idDiv_SAOTCAS_Description`,
    async handler(page: Page, selected: ElementHandle): Promise<void> {
      const descriptionMessage =
        (await page.evaluate(
          (description) => description.textContent,
          selected
        )) ?? "";

      debug("Checking if authentication code is displayed");

      if (descriptionMessage.includes("enter the number shown to sign in")) {
        const authenticationCodeElement = await page.$(
          "#idRichContext_DisplaySign"
        );
        debug("Reading the authentication code");
        const authenticationCode = await page.evaluate(
          (element) => element?.textContent,
          authenticationCodeElement
        );
        debug("Printing the authentication code to console");
        console.log(authenticationCode);
      }
      debug("Waiting for response");
      await page.waitForSelector(`#idDiv_SAOTCAS_Description`, {
        hidden: true,
        timeout: 60000,
      });
    },
  },
  {
    name: "TFA failed",
    selector: `#idDiv_SAASDS_Description,#idDiv_SAASTO_Description`,
    async handler(page: Page, selected: ElementHandle): Promise<void> {
      const descriptionMessage =
        (await page.evaluate(
          (description) => description.textContent,
          selected
        )) ?? "";

      throw new CLIError(descriptionMessage);
    },
  },
  {
    name: "TFA code input",
    selector: "input[name=otc]:not(.moveOffScreen)",
    async handler(page: Page): Promise<void> {
      const error = await page.$(".alert-error");
      if (error) {
        debug("Found error message. Displaying");
        const errorMessage = await page.evaluate(
          (err) => err.textContent,
          error
        );
        console.log(errorMessage);
      } else {
        const description = await page.$("#idDiv_SAOTCC_Description");
        const descriptionMessage = await page.evaluate(
          (element) => element?.textContent,
          description
        );
        console.log(descriptionMessage);
      }

      const { verificationCode } = await inquirer.prompt([
        {
          name: "verificationCode",
          message: "Verification Code:",
        } as Question,
      ]);

      debug("Focusing on verification code input");
      await page.focus(`input[name="otc"]`);

      debug("Clearing input");
      for (let i = 0; i < 100; i++) {
        await page.keyboard.press("Backspace");
      }

      debug("Typing verification code");

      await page.keyboard.type(verificationCode);

      debug("Submitting form");
      await page.click("input[type=submit]");

      debug("Waiting for submission to finish");
      await Promise.race([
        page.waitForSelector(
          `input[name=otc].has-error,input[name=otc].moveOffScreen`,
          { timeout: 60000 }
        ),
        (async (): Promise<void> => {
          await Bluebird.delay(1000);
          await page.waitForSelector(`input[name=otc]`, {
            hidden: true,
            timeout: 60000,
          });
        })(),
      ]);
    },
  },
  {
    name: "Remember me",
    selector: `#KmsiDescription`,
    async handler(
      page: Page,
      _selected: ElementHandle,
      _noPrompt: boolean,
      _defaultUsername: string,
      _defaultPassword: string | undefined,
      rememberMe: boolean
    ): Promise<void> {
      if (rememberMe) {
        debug("Clicking remember me button");
        await page.click("#idSIButton9");
      } else {
        debug("Clicking don't remember button");
        await page.click("#idBtn_Back");
      }

      debug("Waiting for a delay");
      await Bluebird.delay(500);
    },
  },
  {
    name: "Service exception",
    selector: "#service_exception_message",
    async handler(page: Page, selected: ElementHandle): Promise<void> {
      const descriptionMessage =
        (await page.evaluate(
          (description) => description.textContent,
          selected
        )) ?? "";

      throw new CLIError(descriptionMessage);
    },
  },
];

export const login = {
  async loginAsync(
    profileName: string,
    mode: string,
    disableSandbox: boolean,
    noPrompt: boolean,
    enableChromeNetworkService: boolean,
    awsNoVerifySsl: boolean,
    enableChromeSeamlessSso: boolean,
    noDisableExtensions: boolean,
    disableGpu: boolean
  ): Promise<void> {
    let headless, cliProxy;
    if (mode === "cli") {
      headless = true;
      cliProxy = true;
    } else if (mode === "gui") {
      headless = false;
      cliProxy = false;
    } else if (mode === "debug") {
      headless = false;
      cliProxy = true;
    } else {
      throw new CLIError("Invalid mode");
    }

    const profile = await loadProfile(profileName);
    let assertionConsumerServiceURL = AWS_SAML_ENDPOINT;
    if (profile.region && profile.region.startsWith("us-gov")) {
      assertionConsumerServiceURL = AWS_GOV_SAML_ENDPOINT;
    }
    if (profile.region && profile.region.startsWith("cn-")) {
      assertionConsumerServiceURL = AWS_CN_SAML_ENDPOINT;
    }

    console.log("Using AWS SAML endpoint", assertionConsumerServiceURL);

    const loginUrl = await getLoginUrl(
      profile.azure_app_id_uri,
      profile.azure_tenant_id,
      assertionConsumerServiceURL
    );
    const samlResponse = await this._performLoginAsync(
      loginUrl,
      headless,
      disableSandbox,
      cliProxy,
      noPrompt,
      enableChromeNetworkService,
      profile.azure_default_username,
      profile.azure_default_password,
      enableChromeSeamlessSso,
      profile.azure_default_remember_me,
      noDisableExtensions,
      disableGpu
    );
    const roles = parseRolesFromSamlResponse(samlResponse);
    const { role, durationHours } = await askUserForRoleAndDurationAsync(
      roles,
      noPrompt,
      profile.azure_default_role_arn,
      profile.azure_default_duration_hours
    );

    await assumeRoleAsync(
      profileName,
      samlResponse,
      role,
      durationHours,
      awsNoVerifySsl,
      profile.region
    );
  },

  async loginAll(
    mode: string,
    disableSandbox: boolean,
    noPrompt: boolean,
    enableChromeNetworkService: boolean,
    awsNoVerifySsl: boolean,
    enableChromeSeamlessSso: boolean,
    forceRefresh: boolean,
    noDisableExtensions: boolean,
    disableGpu: boolean
  ): Promise<void> {
    const profiles = await awsConfig.getAllProfileNames();

    if (!profiles) {
      return;
    }

    for (const profile of profiles) {
      debug(`Check if profile ${profile} is expired or is about to expire`);
      if (
        !forceRefresh &&
        !(await awsConfig.isProfileAboutToExpireAsync(profile))
      ) {
        debug(`Profile ${profile} not yet due for refresh.`);
        continue;
      }

      debug(`Run login for profile: ${profile}`);
      await this.loginAsync(
        profile,
        mode,
        disableSandbox,
        noPrompt,
        enableChromeNetworkService,
        awsNoVerifySsl,
        enableChromeSeamlessSso,
        noDisableExtensions,
        disableGpu
      );
    }
  },

  /**
   * Perform the login using Chrome.
   * @param {string} url - The login URL
   * @param {boolean} headless - True to hide the GUI, false to show it.
   * @param {boolean} disableSandbox - True to disable the Puppeteer sandbox.
   * @param {boolean} cliProxy - True to proxy input/output through the CLI, false to leave it in the GUI
   * @param {boolean} [noPrompt] - Enable skipping of user prompting
   * @param {boolean} [enableChromeNetworkService] - Enable chrome network service.
   * @param {string} [defaultUsername] - The default username
   * @param {string} [defaultPassword] - The default password
   * @param {boolean} [enableChromeSeamlessSso] - chrome seamless SSO
   * @param {boolean} [rememberMe] - Enable remembering the session
   * @param {boolean} [noDisableExtensions] - True to prevent Puppeteer from disabling Chromium extensions
   * @param {boolean} [disableGpu] - Disables GPU Acceleration
   * @returns {Promise.<string>} The SAML response.
   * @private
   */
  async _performLoginAsync(
    url: string,
    headless: boolean,
    disableSandbox: boolean,
    cliProxy: boolean,
    noPrompt: boolean,
    enableChromeNetworkService: boolean,
    defaultUsername: string,
    defaultPassword: string | undefined,
    enableChromeSeamlessSso: boolean,
    rememberMe: boolean,
    noDisableExtensions: boolean,
    disableGpu: boolean
  ): Promise<string> {
    debug("Loading login page in Chrome");

    let browser: Browser | undefined;

    try {
      const args = headless
        ? []
        : [`--app=${url}`, `--window-size=${WIDTH},${HEIGHT}`];
      if (disableSandbox) args.push("--no-sandbox");
      if (enableChromeNetworkService)
        args.push("--enable-features=NetworkService");
      if (enableChromeSeamlessSso)
        args.push(
          `--auth-server-whitelist=${AZURE_AD_SSO}`,
          `--auth-negotiate-delegate-whitelist=${AZURE_AD_SSO}`
        );
      if (rememberMe) {
        await mkdirp(paths.chromium);
        args.push(`--user-data-dir=${paths.chromium}`);
      }

      if (process.env.https_proxy) {
        args.push(`--proxy-server=${process.env.https_proxy}`);
      }

      const ignoreDefaultArgs = noDisableExtensions
        ? ["--disable-extensions"]
        : [];

      if (disableGpu) {
        args.push("--disable-gpu");
      }

      browser = await puppeteer.launch({
        headless,
        args,
        ignoreDefaultArgs,
      });

      // Wait for a bit as sometimes the browser isn't ready.
      await Bluebird.delay(200);

      const pages = await browser.pages();
      const page = pages[0];
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en",
      });
      await page.setViewport({ width: WIDTH - 15, height: HEIGHT - 35 });

      // Prevent redirection to AWS
      let samlResponseData;
      const samlResponsePromise = new Promise((resolve) => {
        page.on("request", (req: HTTPRequest) => {
          const reqURL = req.url();
          debug(`Request: ${url}`);
          if (
            reqURL === AWS_SAML_ENDPOINT ||
            reqURL === AWS_GOV_SAML_ENDPOINT ||
            reqURL === AWS_CN_SAML_ENDPOINT
          ) {
            resolve(undefined);
            samlResponseData = req.postData();

            req.respond({
              status: 200,
              contentType: "text/plain",
              headers: {},
              body: "",
            });
            if (browser) {
              browser.close();
            }
            browser = undefined;
            debug(`Received SAML response, browser closed`);
          } else {
            req.continue();
          }
        });
      });

      debug("Enabling request interception");
      await page.setRequestInterception(true);

      try {
        if (headless || (!headless && cliProxy)) {
          debug("Going to login page");
          await page.goto(url, { waitUntil: "domcontentloaded" });
        } else {
          debug("Waiting for login page to load");
          await page.waitForNavigation({ waitUntil: "networkidle0" });
        }
      } catch (err) {
        if (err instanceof Error) {
          // An error will be thrown if you're still logged in cause the page.goto ot waitForNavigation
          // will be a redirect to AWS. That's usually OK
          debug(`Error occured during loading the first page: ${err.message}`);
        }
      }

      if (cliProxy) {
        let totalUnrecognizedDelay = 0;

        while (true) {
          if (samlResponseData) break;

          let foundState = false;
          for (let i = 0; i < states.length; i++) {
            const state = states[i];

            let selected;
            try {
              selected = await page.$(state.selector);
            } catch (err) {
              if (err instanceof Error) {
                // An error can be thrown if the page isn't in a good state.
                // If one occurs, try again after another loop.
                debug(
                  `Error when running state "${
                    state.name
                  }". ${err.toString()}. Retrying...`
                );
              }
              break;
            }

            if (selected) {
              foundState = true;
              debug(`Found state: ${state.name}`);

              await Promise.race([
                samlResponsePromise,
                state.handler(
                  page,
                  selected,
                  noPrompt,
                  defaultUsername,
                  defaultPassword,
                  rememberMe
                ),
              ]);

              debug(`Finished state: ${state.name}`);

              break;
            }
          }

          if (foundState) {
            totalUnrecognizedDelay = 0;
          } else {
            debug("State not recognized!");
            if (totalUnrecognizedDelay > MAX_UNRECOGNIZED_PAGE_DELAY) {
              const path = "aws-azure-auth-unrecognized-state.png";
              await page.screenshot({ path });
              throw new CLIError(
                `Unable to recognize page state! A screenshot has been dumped to ${path}. If this problem persists, try running with --mode=gui or --mode=debug`
              );
            }

            totalUnrecognizedDelay += DELAY_ON_UNRECOGNIZED_PAGE;
            await Bluebird.delay(DELAY_ON_UNRECOGNIZED_PAGE);
          }
        }
      } else {
        console.log("Please complete the login in the opened window");
        await samlResponsePromise;
      }

      if (!samlResponseData) {
        throw new Error("SAML response not found");
      }

      const samlResponse = querystring.parse(samlResponseData).SAMLResponse;

      debug("Found SAML response", samlResponse);

      if (!samlResponse) {
        throw new Error("SAML response not found");
      } else if (Array.isArray(samlResponse)) {
        throw new Error("SAML can't be an array");
      }

      return samlResponse;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
};

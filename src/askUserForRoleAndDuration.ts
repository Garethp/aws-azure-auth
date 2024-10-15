import inquirer, { QuestionCollection } from "inquirer";
import { CLIError } from "./CLIError";
import _ from "lodash";
import { Role } from "./login";
import { debug } from "./debug";

/**
 * Ask the user for the role they want to use.
 * @param {Array.<{roleArn: string, principalArn: string}>} roles - The roles to pick from
 * @param {boolean} [noPrompt] - Enable skipping of user prompting
 * @param {string} [defaultRoleArn] - The default role ARN
 * @param {number} [defaultDurationHours] - The default session duration in hours
 * @returns {Promise.<{role: string, durationHours: number}>} The selected role and duration
 * @private
 */
export const askUserForRoleAndDurationAsync = async (
  roles: Role[],
  noPrompt: boolean,
  defaultRoleArn: string,
  defaultDurationHours: string
): Promise<{
  role: Role;
  durationHours: number;
}> => {
  let role: Role | undefined;
  let durationHours = parseInt(defaultDurationHours, 10);
  const questions: QuestionCollection[] = [];
  if (roles.length === 0) {
    throw new CLIError("No roles found in SAML response.");
  } else if (roles.length === 1) {
    debug("Choosing the only role in response");
    role = roles[0];
  } else {
    if (noPrompt && defaultRoleArn) {
      role = _.find(roles, ["roleArn", defaultRoleArn]);
    }

    if (role) {
      debug("Valid role found. No need to ask.");
    } else {
      debug("Asking user to choose role");
      questions.push({
        name: "role",
        message: "Role:",
        type: "list",
        choices: _.sortBy(_.map(roles, "roleArn")),
        default: defaultRoleArn,
      });
    }
  }

  if (noPrompt && defaultDurationHours) {
    debug("Default durationHours found. No need to ask.");
  } else {
    questions.push({
      name: "durationHours",
      message: "Session Duration Hours (up to 12):",
      type: "input",
      default: defaultDurationHours || 1,
      validate: (input): boolean | string => {
        input = Number(input);
        if (input > 0 && input <= 12) return true;
        return "Duration hours must be between 0 and 12";
      },
    });
  }

  // Don't prompt for questions if not needed, an unneeded TTYWRAP prevents node from exiting when
  // user is logged in and using multiple profiles --all-profiles and --no-prompt
  if (questions.length > 0) {
    const answers = await inquirer.prompt(questions);
    if (!role) role = _.find(roles, ["roleArn", answers.role]);
    if (answers.durationHours) {
      durationHours = parseInt(answers.durationHours as string, 10);
    }
  }

  if (!role) {
    throw new Error(`Unable to find role`);
  }

  return { role, durationHours };
};

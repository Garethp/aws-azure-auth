import { Role } from "./login";
import { STS, STSClientConfig } from "@aws-sdk/client-sts";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import proxy from "proxy-agent";
import { awsConfig } from "./awsConfig";
import { debug } from "./debug";

/**
 * Assume the role.
 * @param {string} profileName - The profile name
 * @param {string} assertion - The SAML assertion
 * @param {string} role - The role to assume
 * @param {number} durationHours - The session duration in hours
 * @param {boolean} awsNoVerifySsl - Whether to have the AWS CLI verify SSL
 * @param {string} region - AWS region, if specified
 * @returns {Promise} A promise
 * @private
 */
export const assumeRoleAsync = async (
  profileName: string,
  assertion: string,
  role: Role,
  durationHours: number,
  awsNoVerifySsl: boolean,
  region: string
): Promise<void> => {
  console.log(`Assuming role ${role.roleArn} in region ${region}...`);
  let stsOptions: STSClientConfig = {};
  if (process.env.https_proxy) {
    stsOptions = {
      ...stsOptions,
      requestHandler: new NodeHttpHandler({
        httpsAgent: proxy(process.env.https_proxy),
      }),
    };
  }

  if (awsNoVerifySsl) {
    stsOptions = {
      ...stsOptions,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new Agent({
          rejectUnauthorized: false,
        }),
      }),
    };
  }

  if (region) {
    stsOptions = {
      ...stsOptions,
      region,
    };
  }

  const sts = new STS(stsOptions);
  const res = await sts.assumeRoleWithSAML({
    PrincipalArn: role.principalArn,
    RoleArn: role.roleArn,
    SAMLAssertion: assertion,
    DurationSeconds: Math.round(durationHours * 60 * 60),
  });

  if (!res.Credentials) {
    debug("Unable to get security credentials from AWS");
    return;
  }

  await awsConfig.setProfileCredentialsAsync(profileName, {
    aws_access_key_id: res.Credentials.AccessKeyId ?? "",
    aws_secret_access_key: res.Credentials.SecretAccessKey ?? "",
    aws_session_token: res.Credentials.SessionToken ?? "",
    aws_expiration: res.Credentials.Expiration?.toISOString() ?? "",
  });
};

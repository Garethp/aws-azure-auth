import { awsConfig, ProfileConfig } from "./awsConfig";
import { CLIError } from "./CLIError";
import { loadProfileFromEnv } from "./loadProfileFromEnv";

export const loadProfile = async (
  profileName: string
): Promise<ProfileConfig> => {
  const profile = await awsConfig.getProfileConfigAsync(profileName);

  if (!profile)
    throw new CLIError(
      `Unknown profile '${profileName}'. You must configure it first with --configure.`
    );

  const env = loadProfileFromEnv();
  for (const prop in env) {
    if (env[prop]) {
      profile[prop] = env[prop] === null ? profile[prop] : env[prop];
    }
  }

  if (!profile.azure_tenant_id || !profile.azure_app_id_uri)
    throw new CLIError(`Profile '${profileName}' is not configured properly.`);

  console.log(`Logging in with profile '${profileName}'...`);
  return profile;
};

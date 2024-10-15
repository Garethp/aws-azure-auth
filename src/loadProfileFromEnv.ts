import { debug } from "./debug";

export const loadProfileFromEnv = (): Record<string, string> => {
  const env: { [key: string]: string } = {};
  const options = [
    "azure_tenant_id",
    "azure_app_id_uri",
    "azure_default_username",
    "azure_default_password",
    "azure_default_role_arn",
    "azure_default_duration_hours",
  ];
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const envVar = process.env[opt];
    const envVarUpperCase = process.env[opt.toUpperCase()];

    if (envVar) {
      env[opt] = envVar;
    } else if (envVarUpperCase) {
      env[opt] = envVarUpperCase;
    }
  }
  debug("Environment");
  debug({
    ...env,
    azure_default_password: "xxxxxxxxxx",
  });
  return env;
};

import { load } from "cheerio";
import { Role } from "./login";
import { debug } from "./debug";

/**
 * Parse AWS roles out of the SAML response
 * @param {string} assertion - The SAML assertion
 * @returns {Array.<{roleArn: string, principalArn: string}>} The roles
 * @private
 */
export const parseRolesFromSamlResponse = (assertion: string): Role[] => {
  debug("Converting assertion from base64 to ASCII");
  const samlText = Buffer.from(assertion, "base64").toString("ascii");
  debug("Converted", samlText);

  debug("Parsing SAML XML");
  const saml = load(samlText, { xmlMode: true });

  debug("Looking for role SAML attribute");
  const roles: Role[] = saml(
    "Attribute[Name='https://aws.amazon.com/SAML/Attributes/Role']>AttributeValue"
  )
    .map(function () {
      // @ts-ignore
      const roleAndPrincipal = saml(this).text();
      const parts = roleAndPrincipal.split(",");

      // Role / Principal claims may be in either order
      const [roleIdx, principalIdx] = parts[0].includes(":role/")
        ? [0, 1]
        : [1, 0];
      const roleArn = parts[roleIdx].trim();
      const principalArn = parts[principalIdx].trim();
      return { roleArn, principalArn };
    })
    .get();
  debug("Found roles", roles);
  return roles;
};

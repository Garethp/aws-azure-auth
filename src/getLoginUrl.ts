import { v4 } from "uuid";
import zlib from "zlib";
import { debug } from "./debug";

/**
 * Create the Azure login SAML URL.
 * @param {string} appIdUri - The app ID URI
 * @param {string} tenantId - The Azure tenant ID
 * @param {string} assertionConsumerServiceURL - The AWS SAML endpoint that Azure should send the SAML response to
 * @returns {string} The login URL
 * @private
 */
export const getLoginUrl = async (
  appIdUri: string,
  tenantId: string,
  assertionConsumerServiceURL: string
): Promise<string> => {
  debug("Generating UUID for SAML request");
  const id = v4();

  const samlRequest = `
        <samlp:AuthnRequest xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ID="id${id}" Version="2.0" IssueInstant="${new Date().toISOString()}" IsPassive="false" AssertionConsumerServiceURL="${assertionConsumerServiceURL}" xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
            <Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${appIdUri}</Issuer>
            <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"></samlp:NameIDPolicy>
        </samlp:AuthnRequest>
        `;
  debug("Generated SAML request", samlRequest);

  debug("Deflating SAML");

  return new Promise((resolve, reject) => {
    zlib.deflateRaw(samlRequest, (err, samlBuffer) => {
      if (err) {
        return reject(err);
      }

      debug("Encoding SAML in base64");
      const samlBase64 = samlBuffer.toString("base64");

      const url = `https://login.microsoftonline.com/${tenantId}/saml2?SAMLRequest=${encodeURIComponent(
        samlBase64
      )}`;
      debug("Created login URL", url);

      return resolve(url);
    });
  });
};

const setProfileCredentialsMock = jest.fn(async () => ({}));

jest.mock("@aws-sdk/client-sts", () => ({
  STS: jest.fn(() => ({
    assumeRoleWithSAML: assumeRoleMock,
  })),
}));

jest.mock("./awsConfig", () => ({
  awsConfig: {
    setProfileCredentialsAsync: setProfileCredentialsMock,
  },
}));

import { assumeRoleAsync } from "./assumeRole";
import { STS } from "@aws-sdk/client-sts";

const assumeRoleMock = jest.fn(() => ({
  Credentials: {
    AccessKeyId: "access-key-id",
    SecretAccessKey: "secret-access-key",
    SessionToken: "session-token",
    Expiration: new Date(),
  },
}));

describe("STS Assume Role", () => {
  it("should call AwsConfig.SetProfileCredentials on a successful call", async () => {
    await assumeRoleAsync(
      "test-profile",
      "saml-assertion",
      { principalArn: "principal-arn", roleArn: "role-arn" },
      1,
      false,
      "eu-west-2"
    );

    expect(STS).toHaveBeenCalledWith({
      region: "eu-west-2",
    });

    expect(assumeRoleMock).toHaveBeenCalledWith({
      PrincipalArn: "principal-arn",
      RoleArn: "role-arn",
      SAMLAssertion: "saml-assertion",
      DurationSeconds: 3600,
    });

    expect(setProfileCredentialsMock).toHaveBeenCalledWith("test-profile", {
      aws_access_key_id: "access-key-id",
      aws_secret_access_key: "secret-access-key",
      aws_session_token: "session-token",
      aws_expiration: expect.any(String),
    });
  });

  it("should not call setPorfileCredentials if no credentials were returned", async () => {
    // @ts-ignore
    assumeRoleMock.mockImplementationOnce(() => ({}));

    await expect(
      assumeRoleAsync(
        "test-profile",
        "saml-assertion",
        { principalArn: "principal-arn", roleArn: "role-arn" },
        1,
        false,
        "eu-west-2"
      )
    ).resolves.toBeUndefined();

    expect(STS).toHaveBeenCalledWith({
      region: "eu-west-2",
    });

    expect(assumeRoleMock).toHaveBeenCalledWith({
      PrincipalArn: "principal-arn",
      RoleArn: "role-arn",
      SAMLAssertion: "saml-assertion",
      DurationSeconds: 3600,
    });

    expect(setProfileCredentialsMock).not.toHaveBeenCalled();
  });

  it.todo(
    "should set the HttpHandler with the http_proxy if env.https_proxy is set"
  );

  it.todo("should set rejectedUnauthorized to false if awsNoVerifySsl is set");
});

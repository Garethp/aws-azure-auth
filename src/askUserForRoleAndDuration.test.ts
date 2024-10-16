import { CLIError } from "./CLIError";

const roles: Role[] = [
  {
    principalArn: "principal-arn-1",
    roleArn: "role-arn-1",
  },
  {
    principalArn: "principal-arn-2",
    roleArn: "role-arn-2",
  },
];

const promptMock = jest.fn((): { role?: string; durationHours?: string } => ({
  role: roles[0].roleArn,
  durationHours: "1",
}));

jest.mock("inquirer", () => ({
  prompt: promptMock,
}));

import { Role } from "./login";
import { askUserForRoleAndDurationAsync } from "./askUserForRoleAndDuration";

describe("Ask User For Role and Duration", () => {
  it("should ask the user to pick from a list of roles if there is no default and a duration if there is no default", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: roles[0].roleArn,
      durationHours: "1",
    }));

    const answers = await askUserForRoleAndDurationAsync(roles, true, "", "");

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: [roles[0].roleArn, roles[1].roleArn],
        default: "",
      }),
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);

    expect(answers).toEqual({ role: roles[0], durationHours: 1 });
  });

  it("should throw an error if no roles are request", async () => {
    await expect(
      askUserForRoleAndDurationAsync([], true, "", "")
    ).rejects.toEqual(new CLIError("No roles found in SAML response."));

    expect(promptMock).toHaveBeenCalledTimes(0);
  });

  it("should not ask the user to pick a role if there is only one configured", async () => {
    promptMock.mockImplementationOnce(() => ({
      durationHours: "1",
    }));

    const answers = await askUserForRoleAndDurationAsync(
      [roles[1]],
      true,
      "",
      ""
    );

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);

    expect(answers).toEqual({ role: roles[1], durationHours: 1 });
  });

  it("should order the roles in the prompt list alphabetically", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: "role-2",
      durationHours: "1",
    }));

    await askUserForRoleAndDurationAsync(
      [
        {
          roleArn: "role-2",
          principalArn: "principal",
        },
        {
          roleArn: "role-1",
          principalArn: "principal",
        },
      ],
      true,
      "",
      ""
    );

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: ["role-1", "role-2"],
        default: "",
      }),
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);
  });

  it("should not ask the user to pick a role if noPrompt is true and defaultRoleArn matches a role", async () => {
    promptMock.mockImplementationOnce(() => ({
      durationHours: "1",
    }));

    const answers = await askUserForRoleAndDurationAsync(
      [roles[1]],
      true,
      roles[1].roleArn,
      ""
    );

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);

    expect(answers).toEqual({ role: roles[1], durationHours: 1 });
  });

  it("should ask the the user to pick a role if noPrompt is false and default to defaultRoleArn", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: roles[0].roleArn,
      durationHours: "1",
    }));

    const answers = await askUserForRoleAndDurationAsync(
      roles,
      false,
      roles[0].roleArn,
      ""
    );

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: [roles[0].roleArn, roles[1].roleArn],
        default: roles[0].roleArn,
      }),
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);

    expect(answers).toEqual({ role: roles[0], durationHours: 1 });
  });

  it("should ask the the user to pick a role if defaultRoleArn does not match a role", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: roles[0].roleArn,
      durationHours: "1",
    }));

    const answers = await askUserForRoleAndDurationAsync(
      roles,
      true,
      "does-not-exist",
      ""
    );

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: [roles[0].roleArn, roles[1].roleArn],
        default: "does-not-exist",
      }),
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);

    expect(answers).toEqual({ role: roles[0], durationHours: 1 });
  });

  it("should not has the user to pick a duration is noPrompt is true and defaultDurationHours is set", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: roles[0].roleArn,
    }));

    const answers = await askUserForRoleAndDurationAsync(roles, true, "", "2");

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: [roles[0].roleArn, roles[1].roleArn],
        default: "",
      }),
    ]);

    expect(answers).toEqual({ role: roles[0], durationHours: 2 });
  });

  it("should ask the user to pick a duration if noPrompt is false and default to defaultDurationHours", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: roles[0].roleArn,
      durationHours: "2",
    }));

    const answers = await askUserForRoleAndDurationAsync(roles, false, "", "2");

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: [roles[0].roleArn, roles[1].roleArn],
        default: "",
      }),
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: "2",
      }),
    ]);

    expect(answers).toEqual({ role: roles[0], durationHours: 2 });
  });

  it("should ask the user to pick a duration and default to 1 if defaultDurationHours is not set", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: roles[0].roleArn,
      durationHours: "2",
    }));

    const answers = await askUserForRoleAndDurationAsync(roles, true, "", "");

    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "role",
        message: "Role:",
        type: "list",
        choices: [roles[0].roleArn, roles[1].roleArn],
        default: "",
      }),
      expect.objectContaining({
        name: "durationHours",
        message: "Session Duration Hours (up to 12):",
        type: "input",
        default: 1,
      }),
    ]);

    expect(answers).toEqual({ role: roles[0], durationHours: 2 });
  });

  it("should throw an error if the role cannot be found", async () => {
    promptMock.mockImplementationOnce(() => ({
      role: "does-not-exist",
      durationHours: "1",
    }));

    await expect(
      askUserForRoleAndDurationAsync(roles, true, "", "1")
    ).rejects.toEqual(new Error("Unable to find role"));
  });
});

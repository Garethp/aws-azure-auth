# Contributing

## Get started

This project is built in Typescript with the following tools:
 * `yarn` - Our package manager
 * `eslint` - For static analysis
 * `prettier` - For code formatting

Here's some steps that I recommend for getting started with this project:

```sh
# Use nvm to install Node 20
nvm install 20

# Set your default version to Node 20. You can also just run `nvm use 20` if you don't want to set it as a system-wide default
nvm alias default 20

# Enable corepack, which will manage our package manager versions
corepack enable

# Install our dependencies
yarn install

# Build our project and run linting
yarn build
yarn lint
```

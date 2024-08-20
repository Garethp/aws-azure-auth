#!/usr/bin/env bash

docker run --rm -it -v ~/.aws:/root/.aws aws-azure-auth/aws-azure-auth "$@"

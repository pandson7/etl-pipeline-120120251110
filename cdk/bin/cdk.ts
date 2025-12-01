#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TestStack } from '../lib/test-stack';

const app = new cdk.App();
new TestStack(app, 'TestStack120120251110', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '438431148052',
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  }
});

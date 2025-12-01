import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';

export class EtlPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const suffix = '120120251110';

    // S3 Buckets
    const inputBucket = new s3.Bucket(this, `InputBucket${suffix}`, {
      bucketName: `etl-pipeline-input-${this.account}-${suffix}`,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const outputBucket = new s3.Bucket(this, `OutputBucket${suffix}`, {
      bucketName: `etl-pipeline-output-${this.account}-${suffix}`,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB Table
    const jobsTable = new dynamodb.Table(this, `JobsTable${suffix}`, {
      tableName: `etl-jobs-${suffix}`,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Enable auto scaling
    jobsTable.autoScaleReadCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    });
    jobsTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    });

    // Glue IAM Role
    const glueRole = new iam.Role(this, `GlueRole${suffix}`, {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    inputBucket.grantRead(glueRole);
    outputBucket.grantWrite(glueRole);
    jobsTable.grantWriteData(glueRole);

    // Glue Job
    const glueJob = new glue.CfnJob(this, `EtlJob${suffix}`, {
      name: `etl-parquet-to-json-${suffix}`,
      role: glueRole.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: `s3://${inputBucket.bucketName}/scripts/etl_script.py`,
        pythonVersion: '3',
      },
      defaultArguments: {
        '--job-language': 'python',
        '--job-bookmark-option': 'job-bookmark-disable',
        '--enable-metrics': 'true',
        '--enable-continuous-cloudwatch-log': 'true',
        '--INPUT_BUCKET': inputBucket.bucketName,
        '--OUTPUT_BUCKET': outputBucket.bucketName,
        '--JOBS_TABLE': jobsTable.tableName,
      },
      glueVersion: '4.0',
      workerType: 'G.1X',
      numberOfWorkers: 2,
      timeout: 60,
    });

    // Lambda Functions
    const uploadFunction = new lambda.Function(this, `UploadFunction${suffix}`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { randomUUID } = require('crypto');

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { fileName, fileSize } = JSON.parse(event.body);
    const jobId = randomUUID();
    const s3Key = \`uploads/\${jobId}/\${fileName}\`;

    const command = new PutObjectCommand({
      Bucket: process.env.INPUT_BUCKET,
      Key: s3Key,
      ContentType: 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    await dynamodb.send(new PutItemCommand({
      TableName: process.env.JOBS_TABLE,
      Item: {
        jobId: { S: jobId },
        fileName: { S: fileName },
        status: { S: 'PENDING' },
        createdAt: { S: new Date().toISOString() },
        inputS3Key: { S: s3Key },
        fileSize: { N: fileSize.toString() },
      },
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ jobId, uploadUrl }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
      `),
      environment: {
        INPUT_BUCKET: inputBucket.bucketName,
        JOBS_TABLE: jobsTable.tableName,
      },
    });

    inputBucket.grantWrite(uploadFunction);
    jobsTable.grantWriteData(uploadFunction);

    const jobTriggerFunction = new lambda.Function(this, `JobTriggerFunction${suffix}`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { GlueClient, StartJobRunCommand } = require('@aws-sdk/client-glue');
const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const glue = new GlueClient({});
const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { jobId } = JSON.parse(event.body);

    const jobRun = await glue.send(new StartJobRunCommand({
      JobName: process.env.GLUE_JOB_NAME,
      Arguments: {
        '--JOB_ID_ARG': jobId,
      },
    }));

    await dynamodb.send(new UpdateItemCommand({
      TableName: process.env.JOBS_TABLE,
      Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, glueJobRunId = :runId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': { S: 'RUNNING' },
        ':updatedAt': { S: new Date().toISOString() },
        ':runId': { S: jobRun.JobRunId },
      },
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Job started', jobRunId: jobRun.JobRunId }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
      `),
      environment: {
        GLUE_JOB_NAME: glueJob.name!,
        JOBS_TABLE: jobsTable.tableName,
      },
    });

    jobTriggerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:StartJobRun'],
      resources: [`arn:aws:glue:${this.region}:${this.account}:job/${glueJob.name}`],
    }));
    jobsTable.grantWriteData(jobTriggerFunction);

    const jobStatusFunction = new lambda.Function(this, `JobStatusFunction${suffix}`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { DynamoDBClient, ScanCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    if (event.pathParameters?.jobId) {
      const result = await dynamodb.send(new GetItemCommand({
        TableName: process.env.JOBS_TABLE,
        Key: { jobId: { S: event.pathParameters.jobId } },
      }));

      if (!result.Item) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Job not found' }),
        };
      }

      const job = {
        jobId: result.Item.jobId.S,
        fileName: result.Item.fileName.S,
        status: result.Item.status.S,
        createdAt: result.Item.createdAt.S,
        updatedAt: result.Item.updatedAt?.S,
        outputS3Key: result.Item.outputS3Key?.S,
        errorMessage: result.Item.errorMessage?.S,
        recordCount: result.Item.recordCount?.N,
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(job),
      };
    } else {
      const result = await dynamodb.send(new ScanCommand({
        TableName: process.env.JOBS_TABLE,
      }));

      const jobs = result.Items?.map(item => ({
        jobId: item.jobId.S,
        fileName: item.fileName.S,
        status: item.status.S,
        createdAt: item.createdAt.S,
        updatedAt: item.updatedAt?.S,
        outputS3Key: item.outputS3Key?.S,
        errorMessage: item.errorMessage?.S,
        recordCount: item.recordCount?.N,
      })) || [];

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(jobs),
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
      `),
      environment: {
        JOBS_TABLE: jobsTable.tableName,
      },
    });

    jobsTable.grantReadData(jobStatusFunction);

    const outputFunction = new lambda.Function(this, `OutputFunction${suffix}`, {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const jobId = event.pathParameters.jobId;
    const isDownload = event.queryStringParameters?.download === 'true';

    const jobResult = await dynamodb.send(new GetItemCommand({
      TableName: process.env.JOBS_TABLE,
      Key: { jobId: { S: jobId } },
    }));

    if (!jobResult.Item || !jobResult.Item.outputS3Key) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Output not found' }),
      };
    }

    const s3Key = jobResult.Item.outputS3Key.S;

    if (isDownload) {
      const command = new GetObjectCommand({
        Bucket: process.env.OUTPUT_BUCKET,
        Key: s3Key,
      });
      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ downloadUrl }),
      };
    } else {
      const result = await s3.send(new GetObjectCommand({
        Bucket: process.env.OUTPUT_BUCKET,
        Key: s3Key,
      }));

      const content = await result.Body.transformToString();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ content }),
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
      `),
      environment: {
        OUTPUT_BUCKET: outputBucket.bucketName,
        JOBS_TABLE: jobsTable.tableName,
      },
    });

    outputBucket.grantRead(outputFunction);
    jobsTable.grantReadData(outputFunction);

    // API Gateway
    const api = new apigateway.RestApi(this, `EtlApi${suffix}`, {
      restApiName: `etl-pipeline-api-${suffix}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      },
    });

    const uploadIntegration = new apigateway.LambdaIntegration(uploadFunction);
    api.root.addResource('upload').addMethod('POST', uploadIntegration);

    const jobsResource = api.root.addResource('jobs');
    const jobTriggerIntegration = new apigateway.LambdaIntegration(jobTriggerFunction);
    jobsResource.addMethod('POST', jobTriggerIntegration);

    const jobStatusIntegration = new apigateway.LambdaIntegration(jobStatusFunction);
    jobsResource.addMethod('GET', jobStatusIntegration);

    const jobResource = jobsResource.addResource('{jobId}');
    jobResource.addMethod('GET', jobStatusIntegration);

    const outputResource = api.root.addResource('output').addResource('{jobId}');
    const outputIntegration = new apigateway.LambdaIntegration(outputFunction);
    outputResource.addMethod('GET', outputIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'InputBucketName', {
      value: inputBucket.bucketName,
      description: 'Input S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'OutputBucketName', {
      value: outputBucket.bucketName,
      description: 'Output S3 Bucket Name',
    });
  }
}

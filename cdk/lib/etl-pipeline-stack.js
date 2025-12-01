"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EtlPipelineStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const glue = __importStar(require("aws-cdk-lib/aws-glue"));
class EtlPipelineStack extends cdk.Stack {
    constructor(scope, id, props) {
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
                GLUE_JOB_NAME: glueJob.name,
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
exports.EtlPipelineStack = EtlPipelineStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXRsLXBpcGVsaW5lLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZXRsLXBpcGVsaW5lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx1REFBeUM7QUFDekMsbUVBQXFEO0FBQ3JELCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLDJEQUE2QztBQUc3QyxNQUFhLGdCQUFpQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzdDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxNQUFNLEdBQUcsY0FBYyxDQUFDO1FBRTlCLGFBQWE7UUFDYixNQUFNLFdBQVcsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGNBQWMsTUFBTSxFQUFFLEVBQUU7WUFDOUQsVUFBVSxFQUFFLHNCQUFzQixJQUFJLENBQUMsT0FBTyxJQUFJLE1BQU0sRUFBRTtZQUMxRCxJQUFJLEVBQUUsQ0FBQztvQkFDTCxjQUFjLEVBQUUsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQztvQkFDN0UsY0FBYyxFQUFFLENBQUMsR0FBRyxDQUFDO29CQUNyQixjQUFjLEVBQUUsQ0FBQyxHQUFHLENBQUM7aUJBQ3RCLENBQUM7WUFDRixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILE1BQU0sWUFBWSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsZUFBZSxNQUFNLEVBQUUsRUFBRTtZQUNoRSxVQUFVLEVBQUUsdUJB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QUFTLENBQUMsQ0FBQztRQUM3RSxNQUFNLGlCQUFpQixHQUFHLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQzNFLGNBQWMsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLGlCQUFpQixDQUFDLENBQUM7UUFFbkQsVUFBVTtRQUNWLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQ2hDLEtBQUssRUFBRSxHQUFHLENBQUMsR0FBRztZQUNkLFdBQVcsRUFBRSxpQkFBaUI7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsV0FBVyxDQUFDLFVBQVU7WUFDN0IsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxZQUFZLENBQUMsVUFBVTtZQUM5QixXQUFXLEVBQUUsdUJBQXVCO1NBQ3JDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXhiRCw0Q0F3YkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGdsdWUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWdsdWUnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBjbGFzcyBFdGxQaXBlbGluZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3Qgc3VmZml4ID0gJzEyMDEyMDI1MTExMCc7XG5cbiAgICAvLyBTMyBCdWNrZXRzXG4gICAgY29uc3QgaW5wdXRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGBJbnB1dEJ1Y2tldCR7c3VmZml4fWAsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBldGwtcGlwZWxpbmUtaW5wdXQtJHt0aGlzLmFjY291bnR9LSR7c3VmZml4fWAsXG4gICAgICBjb3JzOiBbe1xuICAgICAgICBhbGxvd2VkTWV0aG9kczogW3MzLkh0dHBNZXRob2RzLkdFVCwgczMuSHR0cE1ldGhvZHMuUE9TVCwgczMuSHR0cE1ldGhvZHMuUFVUXSxcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXG4gICAgICB9XSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICBjb25zdCBvdXRwdXRCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGBPdXRwdXRCdWNrZXQke3N1ZmZpeH1gLCB7XG4gICAgICBidWNrZXROYW1lOiBgZXRsLXBpcGVsaW5lLW91dHB1dC0ke3RoaXMuYWNjb3VudH0tJHtzdWZmaXh9YCxcbiAgICAgIGNvcnM6IFt7XG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbczMuSHR0cE1ldGhvZHMuR0VUXSxcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLFxuICAgICAgICBhbGxvd2VkSGVhZGVyczogWycqJ10sXG4gICAgICB9XSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBEeW5hbW9EQiBUYWJsZVxuICAgIGNvbnN0IGpvYnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBgSm9ic1RhYmxlJHtzdWZmaXh9YCwge1xuICAgICAgdGFibGVOYW1lOiBgZXRsLWpvYnMtJHtzdWZmaXh9YCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnam9iSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBST1ZJU0lPTkVELFxuICAgICAgcmVhZENhcGFjaXR5OiA1LFxuICAgICAgd3JpdGVDYXBhY2l0eTogNSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBFbmFibGUgYXV0byBzY2FsaW5nXG4gICAgam9ic1RhYmxlLmF1dG9TY2FsZVJlYWRDYXBhY2l0eSh7XG4gICAgICBtaW5DYXBhY2l0eTogMSxcbiAgICAgIG1heENhcGFjaXR5OiAxMCxcbiAgICB9KTtcbiAgICBqb2JzVGFibGUuYXV0b1NjYWxlV3JpdGVDYXBhY2l0eSh7XG4gICAgICBtaW5DYXBhY2l0eTogMSxcbiAgICAgIG1heENhcGFjaXR5OiAxMCxcbiAgICB9KTtcblxuICAgIC8vIEdsdWUgSUFNIFJvbGVcbiAgICBjb25zdCBnbHVlUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBgR2x1ZVJvbGUke3N1ZmZpeH1gLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZ2x1ZS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTR2x1ZVNlcnZpY2VSb2xlJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgaW5wdXRCdWNrZXQuZ3JhbnRSZWFkKGdsdWVSb2xlKTtcbiAgICBvdXRwdXRCdWNrZXQuZ3JhbnRXcml0ZShnbHVlUm9sZSk7XG4gICAgam9ic1RhYmxlLmdyYW50V3JpdGVEYXRhKGdsdWVSb2xlKTtcblxuICAgIC8vIEdsdWUgSm9iXG4gICAgY29uc3QgZ2x1ZUpvYiA9IG5ldyBnbHVlLkNmbkpvYih0aGlzLCBgRXRsSm9iJHtzdWZmaXh9YCwge1xuICAgICAgbmFtZTogYGV0bC1wYXJxdWV0LXRvLWpzb24tJHtzdWZmaXh9YCxcbiAgICAgIHJvbGU6IGdsdWVSb2xlLnJvbGVBcm4sXG4gICAgICBjb21tYW5kOiB7XG4gICAgICAgIG5hbWU6ICdnbHVlZXRsJyxcbiAgICAgICAgc2NyaXB0TG9jYXRpb246IGBzMzovLyR7aW5wdXRCdWNrZXQuYnVja2V0TmFtZX0vc2NyaXB0cy9ldGxfc2NyaXB0LnB5YCxcbiAgICAgICAgcHl0aG9uVmVyc2lvbjogJzMnLFxuICAgICAgfSxcbiAgICAgIGRlZmF1bHRBcmd1bWVudHM6IHtcbiAgICAgICAgJy0tam9iLWxhbmd1YWdlJzogJ3B5dGhvbicsXG4gICAgICAgICctLWpvYi1ib29rbWFyay1vcHRpb24nOiAnam9iLWJvb2ttYXJrLWRpc2FibGUnLFxuICAgICAgICAnLS1lbmFibGUtbWV0cmljcyc6ICd0cnVlJyxcbiAgICAgICAgJy0tZW5hYmxlLWNvbnRpbnVvdXMtY2xvdWR3YXRjaC1sb2cnOiAndHJ1ZScsXG4gICAgICAgICctLUlOUFVUX0JVQ0tFVCc6IGlucHV0QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgICctLU9VVFBVVF9CVUNLRVQnOiBvdXRwdXRCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgJy0tSk9CU19UQUJMRSc6IGpvYnNUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgZ2x1ZVZlcnNpb246ICc0LjAnLFxuICAgICAgd29ya2VyVHlwZTogJ0cuMVgnLFxuICAgICAgbnVtYmVyT2ZXb3JrZXJzOiAyLFxuICAgICAgdGltZW91dDogNjAsXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgRnVuY3Rpb25zXG4gICAgY29uc3QgdXBsb2FkRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGBVcGxvYWRGdW5jdGlvbiR7c3VmZml4fWAsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUlubGluZShgXG5jb25zdCB7IFMzQ2xpZW50LCBQdXRPYmplY3RDb21tYW5kIH0gPSByZXF1aXJlKCdAYXdzLXNkay9jbGllbnQtczMnKTtcbmNvbnN0IHsgZ2V0U2lnbmVkVXJsIH0gPSByZXF1aXJlKCdAYXdzLXNkay9zMy1yZXF1ZXN0LXByZXNpZ25lcicpO1xuY29uc3QgeyBEeW5hbW9EQkNsaWVudCwgUHV0SXRlbUNvbW1hbmQgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYicpO1xuY29uc3QgeyByYW5kb21VVUlEIH0gPSByZXF1aXJlKCdjcnlwdG8nKTtcblxuY29uc3QgczMgPSBuZXcgUzNDbGllbnQoe30pO1xuY29uc3QgZHluYW1vZGIgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xuXG5leHBvcnRzLmhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgY29uc3QgaGVhZGVycyA9IHtcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgWC1SZXF1ZXN0ZWQtV2l0aCcsXG4gIH07XG5cbiAgaWYgKGV2ZW50Lmh0dHBNZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDIwMCwgaGVhZGVycyB9O1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IGZpbGVOYW1lLCBmaWxlU2l6ZSB9ID0gSlNPTi5wYXJzZShldmVudC5ib2R5KTtcbiAgICBjb25zdCBqb2JJZCA9IHJhbmRvbVVVSUQoKTtcbiAgICBjb25zdCBzM0tleSA9IFxcYHVwbG9hZHMvXFwke2pvYklkfS9cXCR7ZmlsZU5hbWV9XFxgO1xuXG4gICAgY29uc3QgY29tbWFuZCA9IG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgIEJ1Y2tldDogcHJvY2Vzcy5lbnYuSU5QVVRfQlVDS0VULFxuICAgICAgS2V5OiBzM0tleSxcbiAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHVwbG9hZFVybCA9IGF3YWl0IGdldFNpZ25lZFVybChzMywgY29tbWFuZCwgeyBleHBpcmVzSW46IDM2MDAgfSk7XG5cbiAgICBhd2FpdCBkeW5hbW9kYi5zZW5kKG5ldyBQdXRJdGVtQ29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkpPQlNfVEFCTEUsXG4gICAgICBJdGVtOiB7XG4gICAgICAgIGpvYklkOiB7IFM6IGpvYklkIH0sXG4gICAgICAgIGZpbGVOYW1lOiB7IFM6IGZpbGVOYW1lIH0sXG4gICAgICAgIHN0YXR1czogeyBTOiAnUEVORElORycgfSxcbiAgICAgICAgY3JlYXRlZEF0OiB7IFM6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxuICAgICAgICBpbnB1dFMzS2V5OiB7IFM6IHMzS2V5IH0sXG4gICAgICAgIGZpbGVTaXplOiB7IE46IGZpbGVTaXplLnRvU3RyaW5nKCkgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGhlYWRlcnMsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGpvYklkLCB1cGxvYWRVcmwgfSksXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgaGVhZGVycyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSksXG4gICAgfTtcbiAgfVxufTtcbiAgICAgIGApLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgSU5QVVRfQlVDS0VUOiBpbnB1dEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBKT0JTX1RBQkxFOiBqb2JzVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlucHV0QnVja2V0LmdyYW50V3JpdGUodXBsb2FkRnVuY3Rpb24pO1xuICAgIGpvYnNUYWJsZS5ncmFudFdyaXRlRGF0YSh1cGxvYWRGdW5jdGlvbik7XG5cbiAgICBjb25zdCBqb2JUcmlnZ2VyRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGBKb2JUcmlnZ2VyRnVuY3Rpb24ke3N1ZmZpeH1gLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21JbmxpbmUoYFxuY29uc3QgeyBHbHVlQ2xpZW50LCBTdGFydEpvYlJ1bkNvbW1hbmQgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL2NsaWVudC1nbHVlJyk7XG5jb25zdCB7IER5bmFtb0RCQ2xpZW50LCBVcGRhdGVJdGVtQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJyk7XG5cbmNvbnN0IGdsdWUgPSBuZXcgR2x1ZUNsaWVudCh7fSk7XG5jb25zdCBkeW5hbW9kYiA9IG5ldyBEeW5hbW9EQkNsaWVudCh7fSk7XG5cbmV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xuICBjb25zdCBoZWFkZXJzID0ge1xuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBYLVJlcXVlc3RlZC1XaXRoJyxcbiAgfTtcblxuICBpZiAoZXZlbnQuaHR0cE1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogMjAwLCBoZWFkZXJzIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHsgam9iSWQgfSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XG5cbiAgICBjb25zdCBqb2JSdW4gPSBhd2FpdCBnbHVlLnNlbmQobmV3IFN0YXJ0Sm9iUnVuQ29tbWFuZCh7XG4gICAgICBKb2JOYW1lOiBwcm9jZXNzLmVudi5HTFVFX0pPQl9OQU1FLFxuICAgICAgQXJndW1lbnRzOiB7XG4gICAgICAgICctLUpPQl9JRF9BUkcnOiBqb2JJZCxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgYXdhaXQgZHluYW1vZGIuc2VuZChuZXcgVXBkYXRlSXRlbUNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5KT0JTX1RBQkxFLFxuICAgICAgS2V5OiB7IGpvYklkOiB7IFM6IGpvYklkIH0gfSxcbiAgICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsIHVwZGF0ZWRBdCA9IDp1cGRhdGVkQXQsIGdsdWVKb2JSdW5JZCA9IDpydW5JZCcsXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHsgJyNzdGF0dXMnOiAnc3RhdHVzJyB9LFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xuICAgICAgICAnOnN0YXR1cyc6IHsgUzogJ1JVTk5JTkcnIH0sXG4gICAgICAgICc6dXBkYXRlZEF0JzogeyBTOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSxcbiAgICAgICAgJzpydW5JZCc6IHsgUzogam9iUnVuLkpvYlJ1bklkIH0sXG4gICAgICB9LFxuICAgIH0pKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBoZWFkZXJzLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiAnSm9iIHN0YXJ0ZWQnLCBqb2JSdW5JZDogam9iUnVuLkpvYlJ1bklkIH0pLFxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgIGhlYWRlcnMsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pLFxuICAgIH07XG4gIH1cbn07XG4gICAgICBgKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEdMVUVfSk9CX05BTUU6IGdsdWVKb2IubmFtZSEsXG4gICAgICAgIEpPQlNfVEFCTEU6IGpvYnNUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgam9iVHJpZ2dlckZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2dsdWU6U3RhcnRKb2JSdW4nXSxcbiAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmdsdWU6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmpvYi8ke2dsdWVKb2IubmFtZX1gXSxcbiAgICB9KSk7XG4gICAgam9ic1RhYmxlLmdyYW50V3JpdGVEYXRhKGpvYlRyaWdnZXJGdW5jdGlvbik7XG5cbiAgICBjb25zdCBqb2JTdGF0dXNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYEpvYlN0YXR1c0Z1bmN0aW9uJHtzdWZmaXh9YCwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmNvbnN0IHsgRHluYW1vREJDbGllbnQsIFNjYW5Db21tYW5kLCBHZXRJdGVtQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJyk7XG5cbmNvbnN0IGR5bmFtb2RiID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcblxuZXhwb3J0cy5oYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIFgtUmVxdWVzdGVkLVdpdGgnLFxuICB9O1xuXG4gIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDAsIGhlYWRlcnMgfTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgaWYgKGV2ZW50LnBhdGhQYXJhbWV0ZXJzPy5qb2JJZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vZGIuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkpPQlNfVEFCTEUsXG4gICAgICAgIEtleTogeyBqb2JJZDogeyBTOiBldmVudC5wYXRoUGFyYW1ldGVycy5qb2JJZCB9IH0sXG4gICAgICB9KSk7XG5cbiAgICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICAgICAgaGVhZGVycyxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSm9iIG5vdCBmb3VuZCcgfSksXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGpvYiA9IHtcbiAgICAgICAgam9iSWQ6IHJlc3VsdC5JdGVtLmpvYklkLlMsXG4gICAgICAgIGZpbGVOYW1lOiByZXN1bHQuSXRlbS5maWxlTmFtZS5TLFxuICAgICAgICBzdGF0dXM6IHJlc3VsdC5JdGVtLnN0YXR1cy5TLFxuICAgICAgICBjcmVhdGVkQXQ6IHJlc3VsdC5JdGVtLmNyZWF0ZWRBdC5TLFxuICAgICAgICB1cGRhdGVkQXQ6IHJlc3VsdC5JdGVtLnVwZGF0ZWRBdD8uUyxcbiAgICAgICAgb3V0cHV0UzNLZXk6IHJlc3VsdC5JdGVtLm91dHB1dFMzS2V5Py5TLFxuICAgICAgICBlcnJvck1lc3NhZ2U6IHJlc3VsdC5JdGVtLmVycm9yTWVzc2FnZT8uUyxcbiAgICAgICAgcmVjb3JkQ291bnQ6IHJlc3VsdC5JdGVtLnJlY29yZENvdW50Py5OLFxuICAgICAgfTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShqb2IpLFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZHluYW1vZGIuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IHByb2Nlc3MuZW52LkpPQlNfVEFCTEUsXG4gICAgICB9KSk7XG5cbiAgICAgIGNvbnN0IGpvYnMgPSByZXN1bHQuSXRlbXM/Lm1hcChpdGVtID0+ICh7XG4gICAgICAgIGpvYklkOiBpdGVtLmpvYklkLlMsXG4gICAgICAgIGZpbGVOYW1lOiBpdGVtLmZpbGVOYW1lLlMsXG4gICAgICAgIHN0YXR1czogaXRlbS5zdGF0dXMuUyxcbiAgICAgICAgY3JlYXRlZEF0OiBpdGVtLmNyZWF0ZWRBdC5TLFxuICAgICAgICB1cGRhdGVkQXQ6IGl0ZW0udXBkYXRlZEF0Py5TLFxuICAgICAgICBvdXRwdXRTM0tleTogaXRlbS5vdXRwdXRTM0tleT8uUyxcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBpdGVtLmVycm9yTWVzc2FnZT8uUyxcbiAgICAgICAgcmVjb3JkQ291bnQ6IGl0ZW0ucmVjb3JkQ291bnQ/Lk4sXG4gICAgICB9KSkgfHwgW107XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoam9icyksXG4gICAgICB9O1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgaGVhZGVycyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSksXG4gICAgfTtcbiAgfVxufTtcbiAgICAgIGApLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgSk9CU19UQUJMRTogam9ic1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBqb2JzVGFibGUuZ3JhbnRSZWFkRGF0YShqb2JTdGF0dXNGdW5jdGlvbik7XG5cbiAgICBjb25zdCBvdXRwdXRGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYE91dHB1dEZ1bmN0aW9uJHtzdWZmaXh9YCwge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmNvbnN0IHsgUzNDbGllbnQsIEdldE9iamVjdENvbW1hbmQgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL2NsaWVudC1zMycpO1xuY29uc3QgeyBnZXRTaWduZWRVcmwgfSA9IHJlcXVpcmUoJ0Bhd3Mtc2RrL3MzLXJlcXVlc3QtcHJlc2lnbmVyJyk7XG5jb25zdCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCB9ID0gcmVxdWlyZSgnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJyk7XG5cbmNvbnN0IHMzID0gbmV3IFMzQ2xpZW50KHt9KTtcbmNvbnN0IGR5bmFtb2RiID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcblxuZXhwb3J0cy5oYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIFgtUmVxdWVzdGVkLVdpdGgnLFxuICB9O1xuXG4gIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDAsIGhlYWRlcnMgfTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3Qgam9iSWQgPSBldmVudC5wYXRoUGFyYW1ldGVycy5qb2JJZDtcbiAgICBjb25zdCBpc0Rvd25sb2FkID0gZXZlbnQucXVlcnlTdHJpbmdQYXJhbWV0ZXJzPy5kb3dubG9hZCA9PT0gJ3RydWUnO1xuXG4gICAgY29uc3Qgam9iUmVzdWx0ID0gYXdhaXQgZHluYW1vZGIuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5KT0JTX1RBQkxFLFxuICAgICAgS2V5OiB7IGpvYklkOiB7IFM6IGpvYklkIH0gfSxcbiAgICB9KSk7XG5cbiAgICBpZiAoIWpvYlJlc3VsdC5JdGVtIHx8ICFqb2JSZXN1bHQuSXRlbS5vdXRwdXRTM0tleSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnT3V0cHV0IG5vdCBmb3VuZCcgfSksXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHMzS2V5ID0gam9iUmVzdWx0Lkl0ZW0ub3V0cHV0UzNLZXkuUztcblxuICAgIGlmIChpc0Rvd25sb2FkKSB7XG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICBCdWNrZXQ6IHByb2Nlc3MuZW52Lk9VVFBVVF9CVUNLRVQsXG4gICAgICAgIEtleTogczNLZXksXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGRvd25sb2FkVXJsID0gYXdhaXQgZ2V0U2lnbmVkVXJsKHMzLCBjb21tYW5kLCB7IGV4cGlyZXNJbjogMzYwMCB9KTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGRvd25sb2FkVXJsIH0pLFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgczMuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgIEJ1Y2tldDogcHJvY2Vzcy5lbnYuT1VUUFVUX0JVQ0tFVCxcbiAgICAgICAgS2V5OiBzM0tleSxcbiAgICAgIH0pKTtcblxuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHJlc3VsdC5Cb2R5LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICBcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBjb250ZW50IH0pLFxuICAgICAgfTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgIGhlYWRlcnMsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pLFxuICAgIH07XG4gIH1cbn07XG4gICAgICBgKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIE9VVFBVVF9CVUNLRVQ6IG91dHB1dEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBKT0JTX1RBQkxFOiBqb2JzVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIG91dHB1dEJ1Y2tldC5ncmFudFJlYWQob3V0cHV0RnVuY3Rpb24pO1xuICAgIGpvYnNUYWJsZS5ncmFudFJlYWREYXRhKG91dHB1dEZ1bmN0aW9uKTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBgRXRsQXBpJHtzdWZmaXh9YCwge1xuICAgICAgcmVzdEFwaU5hbWU6IGBldGwtcGlwZWxpbmUtYXBpLSR7c3VmZml4fWAsXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFsnQ29udGVudC1UeXBlJywgJ0F1dGhvcml6YXRpb24nLCAnWC1SZXF1ZXN0ZWQtV2l0aCddLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHVwbG9hZEludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odXBsb2FkRnVuY3Rpb24pO1xuICAgIGFwaS5yb290LmFkZFJlc291cmNlKCd1cGxvYWQnKS5hZGRNZXRob2QoJ1BPU1QnLCB1cGxvYWRJbnRlZ3JhdGlvbik7XG5cbiAgICBjb25zdCBqb2JzUmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnam9icycpO1xuICAgIGNvbnN0IGpvYlRyaWdnZXJJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGpvYlRyaWdnZXJGdW5jdGlvbik7XG4gICAgam9ic1Jlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGpvYlRyaWdnZXJJbnRlZ3JhdGlvbik7XG5cbiAgICBjb25zdCBqb2JTdGF0dXNJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGpvYlN0YXR1c0Z1bmN0aW9uKTtcbiAgICBqb2JzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBqb2JTdGF0dXNJbnRlZ3JhdGlvbik7XG5cbiAgICBjb25zdCBqb2JSZXNvdXJjZSA9IGpvYnNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2pvYklkfScpO1xuICAgIGpvYlJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgam9iU3RhdHVzSW50ZWdyYXRpb24pO1xuXG4gICAgY29uc3Qgb3V0cHV0UmVzb3VyY2UgPSBhcGkucm9vdC5hZGRSZXNvdXJjZSgnb3V0cHV0JykuYWRkUmVzb3VyY2UoJ3tqb2JJZH0nKTtcbiAgICBjb25zdCBvdXRwdXRJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKG91dHB1dEZ1bmN0aW9uKTtcbiAgICBvdXRwdXRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG91dHB1dEludGVncmF0aW9uKTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpVXJsJywge1xuICAgICAgdmFsdWU6IGFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSW5wdXRCdWNrZXROYW1lJywge1xuICAgICAgdmFsdWU6IGlucHV0QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0lucHV0IFMzIEJ1Y2tldCBOYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPdXRwdXRCdWNrZXROYW1lJywge1xuICAgICAgdmFsdWU6IG91dHB1dEJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdPdXRwdXQgUzMgQnVja2V0IE5hbWUnLFxuICAgIH0pO1xuICB9XG59XG4iXX0=
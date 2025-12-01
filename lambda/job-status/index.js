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

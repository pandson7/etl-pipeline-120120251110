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

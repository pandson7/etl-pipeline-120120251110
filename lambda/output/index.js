const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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

    // List all part files in the output directory
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.OUTPUT_BUCKET,
      Prefix: s3Key + '/',
    }));

    if (!listResult.Contents || listResult.Contents.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Output files not found' }),
      };
    }

    if (isDownload) {
      // For download, provide the first part file
      const firstPartKey = listResult.Contents[0].Key;
      const command = new GetObjectCommand({
        Bucket: process.env.OUTPUT_BUCKET,
        Key: firstPartKey,
      });
      const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ downloadUrl }),
      };
    } else {
      // For viewing, get the first part file content (first 10 lines)
      const firstPartKey = listResult.Contents[0].Key;
      const result = await s3.send(new GetObjectCommand({
        Bucket: process.env.OUTPUT_BUCKET,
        Key: firstPartKey,
      }));

      const content = await result.Body.transformToString();
      const lines = content.split('\n').slice(0, 10); // First 10 lines
      const preview = lines.join('\n') + '\n\n... (showing first 10 records out of ' + jobResult.Item.recordCount?.N + ' total records)';
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ content: preview }),
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

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
    const s3Key = `uploads/${jobId}/${fileName}`;

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

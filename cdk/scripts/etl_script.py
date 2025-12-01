import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
import boto3
from datetime import datetime

# Get job arguments
args = getResolvedOptions(sys.argv, [
    'JOB_NAME',
    'JOB_ID_ARG',
    'INPUT_BUCKET',
    'OUTPUT_BUCKET',
    'JOBS_TABLE'
])

# Initialize Glue context
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Initialize DynamoDB client
dynamodb = boto3.client('dynamodb')

def update_job_status(job_id, status, error_message=None, output_s3_key=None, record_count=None):
    """Update job status in DynamoDB"""
    update_expression = "SET #status = :status, updatedAt = :updatedAt"
    expression_attribute_names = {"#status": "status"}
    expression_attribute_values = {
        ":status": {"S": status},
        ":updatedAt": {"S": datetime.now().isoformat()}
    }
    
    if error_message:
        update_expression += ", errorMessage = :errorMessage"
        expression_attribute_values[":errorMessage"] = {"S": error_message}
    
    if output_s3_key:
        update_expression += ", outputS3Key = :outputS3Key"
        expression_attribute_values[":outputS3Key"] = {"S": output_s3_key}
    
    if record_count is not None:
        update_expression += ", recordCount = :recordCount"
        expression_attribute_values[":recordCount"] = {"N": str(record_count)}
    
    try:
        dynamodb.update_item(
            TableName=args['JOBS_TABLE'],
            Key={"jobId": {"S": job_id}},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
    except Exception as e:
        print(f"Error updating job status: {str(e)}")

def get_job_details(job_id):
    """Get job details from DynamoDB"""
    try:
        response = dynamodb.get_item(
            TableName=args['JOBS_TABLE'],
            Key={"jobId": {"S": job_id}}
        )
        return response.get('Item')
    except Exception as e:
        print(f"Error getting job details: {str(e)}")
        return None

try:
    job_id = args['JOB_ID_ARG']
    print(f"Processing job: {job_id}")
    
    # Get job details
    job_details = get_job_details(job_id)
    if not job_details:
        raise Exception(f"Job {job_id} not found in database")
    
    input_s3_key = job_details['inputS3Key']['S']
    input_path = f"s3://{args['INPUT_BUCKET']}/{input_s3_key}"
    
    print(f"Reading Parquet file from: {input_path}")
    
    # Read Parquet file
    dynamic_frame = glueContext.create_dynamic_frame.from_options(
        format_options={},
        connection_type="s3",
        format="parquet",
        connection_options={
            "paths": [input_path],
            "recurse": True
        }
    )
    
    # Convert to DataFrame for processing
    df = dynamic_frame.toDF()
    record_count = df.count()
    
    print(f"Processing {record_count} records")
    
    # Convert back to DynamicFrame for output
    output_dynamic_frame = DynamicFrame.fromDF(df, glueContext, "output_frame")
    
    # Define output path
    output_s3_key = f"output/{job_id}/output.json"
    output_path = f"s3://{args['OUTPUT_BUCKET']}/{output_s3_key}"
    
    print(f"Writing JSON output to: {output_path}")
    
    # Write as JSON
    glueContext.write_dynamic_frame.from_options(
        frame=output_dynamic_frame,
        connection_type="s3",
        connection_options={
            "path": output_path
        },
        format="json"
    )
    
    # Update job status to completed
    update_job_status(job_id, "COMPLETED", output_s3_key=output_s3_key, record_count=record_count)
    
    print(f"Job {job_id} completed successfully")

except Exception as e:
    error_message = str(e)
    print(f"Job failed: {error_message}")
    
    # Update job status to failed
    update_job_status(args['JOB_ID_ARG'], "FAILED", error_message=error_message)
    
    raise e

finally:
    job.commit()

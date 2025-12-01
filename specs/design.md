# Technical Design Document

## Architecture Overview

The ETL pipeline system consists of the following components:
- **Frontend**: React application for file upload and job monitoring
- **Backend API**: Node.js API Gateway endpoints for file management and job control
- **ETL Engine**: AWS Glue jobs for Parquet to JSON transformation
- **Storage**: S3 buckets for input/output files
- **Metadata Store**: DynamoDB for job and file metadata
- **Infrastructure**: AWS CDK for deployment

## System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend│    │  API Gateway    │    │   Lambda        │
│   - File Upload │────│  - REST APIs    │────│   - Job Control │
│   - Job Monitor │    │  - CORS Config  │    │   - File Mgmt   │
│   - Output View │    └─────────────────┘    └─────────────────┘
└─────────────────┘                                      │
                                                         │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   S3 Buckets    │    │   DynamoDB      │    │   AWS Glue      │
│   - Input Files │────│   - Job Metadata│────│   - ETL Jobs    │
│   - Output JSON │    │   - File Info   │    │   - Transform   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Component Design

### Frontend (React)
- **Technology**: React with functional components and hooks
- **Hosting**: Local development server
- **Key Features**:
  - File upload with drag-and-drop
  - Job status dashboard with real-time updates
  - JSON output viewer with syntax highlighting
  - Download functionality for processed files

### Backend API (Node.js + API Gateway)
- **Runtime**: Node.js 18.x
- **Framework**: AWS Lambda with API Gateway
- **Endpoints**:
  - `POST /upload` - File upload to S3
  - `POST /jobs` - Trigger ETL job
  - `GET /jobs` - List all jobs with status
  - `GET /jobs/{id}` - Get specific job details
  - `GET /output/{id}` - Retrieve JSON output
  - `GET /download/{id}` - Download JSON file

### ETL Processing (AWS Glue)
- **Job Type**: AWS Glue ETL Job
- **Script Language**: Python (PySpark)
- **Worker Type**: G.1X (4 vCPU, 16 GB memory)
- **Transformation Logic**:
  - Read Parquet files from S3
  - Convert to Spark DataFrame
  - Transform to JSON format
  - Write JSON output to S3
  - Update job status in DynamoDB

### Data Storage

#### S3 Buckets
- **Input Bucket**: `etl-pipeline-input-{account-id}`
  - Stores uploaded Parquet files
  - Versioning enabled
  - Lifecycle policy for cleanup
- **Output Bucket**: `etl-pipeline-output-{account-id}`
  - Stores transformed JSON files
  - Public read access for downloads

#### DynamoDB Tables
- **Jobs Table**: `etl-jobs`
  - Primary Key: `jobId` (String)
  - Attributes:
    - `fileName` (String)
    - `status` (String) - PENDING, RUNNING, COMPLETED, FAILED
    - `createdAt` (String)
    - `updatedAt` (String)
    - `inputS3Key` (String)
    - `outputS3Key` (String)
    - `errorMessage` (String)
    - `recordCount` (Number)

## Sequence Diagrams

### File Upload and ETL Trigger Flow
```
User -> Frontend: Upload Parquet file
Frontend -> API Gateway: POST /upload
API Gateway -> Lambda: Process upload
Lambda -> S3: Store file
Lambda -> DynamoDB: Create job record
Lambda -> Glue: Start ETL job
Glue -> S3: Read Parquet file
Glue -> S3: Write JSON output
Glue -> DynamoDB: Update job status
Frontend -> API Gateway: Poll job status
API Gateway -> DynamoDB: Query job status
DynamoDB -> Frontend: Return status updates
```

### Output Retrieval Flow
```
User -> Frontend: View/Download output
Frontend -> API Gateway: GET /output/{id}
API Gateway -> Lambda: Process request
Lambda -> DynamoDB: Get job details
Lambda -> S3: Retrieve JSON file
S3 -> Frontend: Return JSON content
```

## Security Considerations

- **API Authentication**: API Gateway with API keys
- **S3 Access**: IAM roles with least privilege
- **DynamoDB Access**: Resource-based policies
- **CORS Configuration**: Restricted to frontend domain
- **Input Validation**: File type and size validation
- **Error Handling**: Sanitized error messages

## Performance Considerations

- **Glue Job Scaling**: Auto-scaling based on data size
- **DynamoDB Capacity**: On-demand billing mode
- **S3 Transfer**: Multipart upload for large files
- **Frontend Caching**: Browser caching for static assets
- **API Rate Limiting**: Throttling to prevent abuse

## Monitoring and Logging

- **CloudWatch Logs**: All Lambda and Glue job logs
- **CloudWatch Metrics**: Custom metrics for job success/failure rates
- **X-Ray Tracing**: Distributed tracing for API calls
- **DynamoDB Metrics**: Read/write capacity monitoring

## Deployment Strategy

- **Infrastructure as Code**: AWS CDK with TypeScript
- **Environment Separation**: Dev/Prod environments
- **CI/CD**: Manual deployment for prototype
- **Resource Naming**: Consistent naming convention with environment prefix

## Data Flow

1. **Input**: User uploads Parquet file via React frontend
2. **Storage**: File stored in S3 input bucket with metadata in DynamoDB
3. **Processing**: AWS Glue job reads Parquet, transforms to JSON
4. **Output**: JSON file stored in S3 output bucket
5. **Notification**: Job status updated in DynamoDB
6. **Retrieval**: User views/downloads JSON via frontend

## Error Handling Strategy

- **File Upload Errors**: Validation and user feedback
- **ETL Job Failures**: Retry mechanism with exponential backoff
- **API Errors**: Structured error responses with appropriate HTTP codes
- **Frontend Errors**: User-friendly error messages with retry options
- **Data Corruption**: Checksum validation for file integrity

## Scalability Design

- **Horizontal Scaling**: Multiple Glue jobs can run concurrently
- **Storage Scaling**: S3 provides unlimited storage capacity
- **Database Scaling**: DynamoDB auto-scaling for read/write capacity
- **API Scaling**: Lambda auto-scaling based on request volume

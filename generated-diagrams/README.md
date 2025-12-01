# ETL Pipeline Architecture Diagrams

This directory contains AWS architecture diagrams for the ETL Pipeline solution that transforms Parquet files to JSON format.

## Generated Diagrams

### 1. ETL Pipeline Architecture (`etl-pipeline-architecture.png`)
**Overview**: High-level system architecture showing all major components and their relationships.

**Components**:
- **User**: End user interacting with the system
- **React App**: Frontend application for file upload and job monitoring
- **API Gateway**: REST API endpoints for backend communication
- **Lambda Functions**: Serverless functions for job control and file management
- **AWS Glue**: ETL processing engine for Parquet to JSON transformation
- **S3 Buckets**: Input and output storage for files
- **DynamoDB**: Metadata store for job tracking
- **CloudWatch**: Monitoring and logging service

**Key Features**:
- Left-to-right data flow from user to storage
- Clustered components for logical grouping
- Clear separation of concerns between layers

### 2. ETL Pipeline Data Flow (`etl-pipeline-dataflow.png`)
**Overview**: Detailed sequence diagram showing the step-by-step data flow through the system.

**Flow Steps**:
1. User uploads Parquet file via React frontend
2. Frontend sends POST request to API Gateway
3. Upload Lambda processes the request
4. File stored in S3 input bucket
5. Job metadata created in DynamoDB
6. Glue ETL job triggered
7. Glue reads Parquet file from S3
8. Glue transforms and writes JSON to output bucket
9. Job status updated in DynamoDB
10. Frontend polls for job status
11. Status Lambda queries DynamoDB
12. User downloads results via download endpoint
13. Download Lambda retrieves files from S3

**Key Features**:
- Top-to-bottom flow showing temporal sequence
- Numbered edges indicating process order
- Separate Lambda functions for different operations
- Comprehensive logging to CloudWatch

### 3. ETL Pipeline Deployment Architecture (`etl-pipeline-deployment.png`)
**Overview**: Infrastructure deployment view showing development environment and AWS cloud resources.

**Development Environment**:
- Developer workstation with local React dev server
- AWS CDK CLI for infrastructure deployment

**AWS Cloud Infrastructure**:
- **API Layer**: API Gateway with multiple Lambda functions
- **ETL Processing**: Glue jobs with data catalog integration
- **Storage Layer**: Dedicated S3 buckets for input and output
- **Database Layer**: DynamoDB table with on-demand billing
- **Monitoring**: CloudWatch metrics/logs and X-Ray tracing
- **Security**: IAM roles and policies for access control

**Key Features**:
- Clear separation between development and cloud environments
- Infrastructure as Code deployment via CDK
- Comprehensive monitoring and security integration
- Scalable serverless architecture

## Architecture Principles

### Serverless Design
- Lambda functions for API processing
- DynamoDB for metadata storage
- S3 for file storage
- Glue for ETL processing

### Scalability
- Auto-scaling Lambda functions
- On-demand DynamoDB capacity
- Unlimited S3 storage
- Glue job auto-scaling based on data size

### Security
- IAM roles with least privilege access
- API Gateway with authentication
- Encrypted storage in S3 and DynamoDB
- VPC isolation where needed

### Monitoring
- CloudWatch for metrics and logs
- X-Ray for distributed tracing
- Custom metrics for business KPIs
- Automated alerting on failures

## File Locations

All diagrams are stored in the `generated-diagrams` directory:
- `/home/pandson/echo-architect-artifacts/etl-pipeline-120120251110/generated-diagrams/etl-pipeline-architecture.png`
- `/home/pandson/echo-architect-artifacts/etl-pipeline-120120251110/generated-diagrams/etl-pipeline-dataflow.png`
- `/home/pandson/echo-architect-artifacts/etl-pipeline-120120251110/generated-diagrams/etl-pipeline-deployment.png`

## Usage

These diagrams can be used for:
- Technical documentation
- Architecture reviews
- Stakeholder presentations
- Development team onboarding
- Infrastructure planning
- Security assessments

# ETL Pipeline Project

## Overview

This project implements an ETL pipeline system that processes Parquet files, transforms them to JSON format, and provides a web interface for file management and job monitoring. The system uses AWS Glue for ETL processing, DynamoDB for metadata storage, and includes a React frontend for user interaction.

## Architecture

- **Frontend**: React application for file upload and job monitoring
- **Backend**: Node.js Lambda functions with API Gateway
- **ETL Engine**: AWS Glue jobs for data transformation
- **Storage**: S3 buckets for input/output files
- **Database**: DynamoDB for metadata and job tracking
- **Infrastructure**: AWS CDK for deployment

## Project Structure

```
etl-pipeline-120120251110/
├── specs/                  # Project specifications
│   ├── requirements.md     # User stories and acceptance criteria
│   ├── design.md          # Technical architecture and design
│   └── tasks.md           # Implementation plan
├── src/                   # Source code
├── tests/                 # Test files
├── cdk-app/              # AWS CDK infrastructure code
├── frontend/             # React frontend application
├── pricing/              # Cost analysis and pricing
├── generated-diagrams/   # Architecture diagrams
└── qr-code/             # QR codes for quick access
```

## Sample Data

The project includes sample Parquet files for testing:
- Location: `~/ea_sample_docs/etl_docs/green_tripdata_2025-01.parquet`
- Format: Apache Parquet
- Size: ~1.2MB

## Getting Started

1. Review the specifications in the `specs/` folder
2. Follow the implementation plan in `tasks.md`
3. Deploy infrastructure using AWS CDK
4. Test with sample data files

## Key Features

- File upload with validation
- Real-time ETL job monitoring
- Parquet to JSON transformation
- Output viewing and downloading
- Comprehensive error handling
- Metadata tracking and logging

## Technology Stack

- **Frontend**: React, JavaScript
- **Backend**: Node.js, AWS Lambda
- **ETL**: AWS Glue, PySpark
- **Storage**: Amazon S3
- **Database**: Amazon DynamoDB
- **Infrastructure**: AWS CDK
- **API**: Amazon API Gateway

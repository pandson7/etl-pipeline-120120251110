import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = 'https://tkolddh781.execute-api.us-east-1.amazonaws.com/prod';

interface Job {
  jobId: string;
  fileName: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  outputS3Key?: string;
  errorMessage?: string;
  recordCount?: string;
}

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewingOutput, setViewingOutput] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/jobs`);
      const data = await response.json();
      setJobs(data);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.parquet')) {
      setSelectedFile(file);
    } else {
      alert('Please select a Parquet file');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      // Get upload URL
      const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
        }),
      });

      const { jobId, uploadUrl } = await uploadResponse.json();

      // Upload file to S3
      await fetch(uploadUrl, {
        method: 'PUT',
        body: selectedFile,
        headers: { 'Content-Type': 'application/octet-stream' },
      });

      alert(`File uploaded successfully! Job ID: ${jobId}`);
      setSelectedFile(null);
      fetchJobs();
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleStartETL = async (jobId: string) => {
    try {
      await fetch(`${API_BASE_URL}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      alert('ETL job started');
      fetchJobs();
    } catch (error) {
      console.error('Error starting ETL:', error);
      alert('Failed to start ETL job');
    }
  };

  const handleViewOutput = async (jobId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/output/${jobId}`);
      const data = await response.json();
      setViewingOutput(data.content);
    } catch (error) {
      console.error('Error viewing output:', error);
      alert('Failed to load output');
    }
  };

  const handleDownload = async (jobId: string, fileName: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/output/${jobId}?download=true`);
      const data = await response.json();
      
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = fileName.replace('.parquet', '.json');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading:', error);
      alert('Failed to download file');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return '#ffa500';
      case 'RUNNING': return '#007bff';
      case 'COMPLETED': return '#28a745';
      case 'FAILED': return '#dc3545';
      default: return '#6c757d';
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>ETL Pipeline Dashboard</h1>
        
        <div className="upload-section">
          <h2>Upload Parquet File</h2>
          <input
            type="file"
            accept=".parquet"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          {selectedFile && (
            <div>
              <p>Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</p>
              <button onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Upload File'}
              </button>
            </div>
          )}
        </div>

        <div className="jobs-section">
          <h2>ETL Jobs</h2>
          <div className="jobs-grid">
            {jobs.map((job) => (
              <div key={job.jobId} className="job-card">
                <h3>{job.fileName}</h3>
                <p>
                  Status: <span style={{ color: getStatusColor(job.status) }}>{job.status}</span>
                </p>
                <p>Created: {new Date(job.createdAt).toLocaleString()}</p>
                {job.updatedAt && (
                  <p>Updated: {new Date(job.updatedAt).toLocaleString()}</p>
                )}
                {job.recordCount && (
                  <p>Records: {job.recordCount}</p>
                )}
                {job.errorMessage && (
                  <p style={{ color: '#dc3545' }}>Error: {job.errorMessage}</p>
                )}
                
                <div className="job-actions">
                  {job.status === 'PENDING' && (
                    <button onClick={() => handleStartETL(job.jobId)}>
                      Start ETL
                    </button>
                  )}
                  {job.status === 'COMPLETED' && job.outputS3Key && (
                    <>
                      <button onClick={() => handleViewOutput(job.jobId)}>
                        View Output
                      </button>
                      <button onClick={() => handleDownload(job.jobId, job.fileName)}>
                        Download JSON
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {viewingOutput && (
          <div className="output-modal">
            <div className="output-content">
              <h3>JSON Output</h3>
              <pre>{viewingOutput}</pre>
              <button onClick={() => setViewingOutput(null)}>Close</button>
            </div>
          </div>
        )}
      </header>
    </div>
  );
}

export default App;

# Node App

A simple Node.js app with clustering, demonstrating fixes for common issues like memory leaks and blocking operations.

## Features

- Clustering for multi-core utilization
- Health check endpoint
- Protected routes with basic authentication
- Logging middleware
- Error handling

## Setup

1. Install dependencies: `npm install`
2. Set up environment: Copy `.env` and update `OPENAI_API_KEY` with your OpenAI API key.
3. Run the app: `npm start`
4. Run tests: `npm test`

## Usage

- `GET /` : Returns "Hello World!"
- `GET /health` : Returns health status with timestamp
- `GET /leak` : Protected route, adds data to array (fixed memory leak). Requires JWT.
- `GET /block` : Protected route, non-blocking delay. Requires JWT.
- `POST /analyze-grievance` : Analyzes a grievance text using semantic search on cases and uploaded PDFs, generates an AI-powered lawyer-ready report. Requires JWT. Body: { "grievance": "text" }
- `POST /upload-pdf` : Uploads a PDF, extracts text, generates embeddings for future grievance analysis. Requires JWT. Multipart form with 'pdf' field.
- `POST /feedback` : Submits feedback on a generated report. Requires JWT. Body: { "grievance_text": "...", "generated_report": "...", "rating": 1-5, "comments": "..." }

### Authentication

For protected routes, use Firebase Authentication:
- POST to `/login` with { "username": "admin", "password": "password" } to get a Firebase custom token.
- Use the custom token with Firebase SDK (client-side) to sign in and obtain an ID token.
- Include `Authorization: Bearer <id_token>` in headers for API requests.

Note: Set up Firebase project and place the service account JSON at `./firebase-service-account.json`.# Trigger redeploy Tue Dec 30 04:19:38 AM UTC 2025

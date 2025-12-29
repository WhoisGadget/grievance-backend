const request = require('supertest');
const app = require('./server');

describe('GET /', () => {
  it('should return Hello World!', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe('Hello World!');
  });
});

describe('GET /health', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

let token;

describe('POST /login', () => {
  it('should login and return token', async () => {
    const res = await request(app)
      .post('/login')
      .send({ username: 'admin', password: 'password' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    token = res.body.token;
  });
});

describe('GET /leak', () => {
  it('should require authentication', async () => {
    const res = await request(app).get('/leak');
    expect(res.statusCode).toEqual(401);
  });

  it('should return data with correct auth', async () => {
    const res = await request(app)
      .get('/leak')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toBe('Data inserted into database');
  });
});

describe('GET /block', () => {
  it('should require authentication', async () => {
    const res = await request(app).get('/block');
    expect(res.statusCode).toEqual(401);
  });

  it('should return delayed response with auth', async () => {
    const res = await request(app)
      .get('/block')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.text).toBe('Delayed for 1 second without blocking');
  });
});

describe('POST /analyze-grievance', () => {
  it('should require authentication', async () => {
    const res = await request(app).post('/analyze-grievance').send({ grievance: 'test' });
    expect(res.statusCode).toEqual(401);
  });

  it('should return report with auth', async () => {
    const res = await request(app)
      .post('/analyze-grievance')
      .set('Authorization', `Bearer ${token}`)
      .send({ grievance: 'overtime pay violation' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.report).toBeDefined();
  });
});

describe('POST /upload-pdf', () => {
  it('should require authentication', async () => {
    const res = await request(app).post('/upload-pdf');
    expect(res.statusCode).toEqual(401);
  });

  // Note: For full test, need a real PDF buffer. Skipping detailed test.
});

describe('POST /feedback', () => {
  it('should require authentication', async () => {
    const res = await request(app).post('/feedback').send({});
    expect(res.statusCode).toEqual(401);
  });

  it('should submit feedback with auth', async () => {
    const res = await request(app)
      .post('/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({ grievance_text: 'test grievance', generated_report: 'test report', rating: 5, comments: 'excellent' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toBe('Feedback submitted successfully');
  });
});
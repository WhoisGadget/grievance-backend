// Replace with the actual Vercel deployed URL
const BASE_URL = 'https://node-app-black.vercel.app';

// Log of actions performed for potential undoing (though these endpoints don't modify state significantly)
let actionLog = [];

(async () => {
  console.log('Starting comprehensive test for Vercel-deployed app endpoints...\n');

  try {
    // Test 1: Health endpoint
    console.log('🔍 Testing /health endpoint...');
    actionLog.push('Fetched /health endpoint');
    const healthResponse = await (async () => {
      const response = await fetch(BASE_URL + '/health');
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
      return {
        status: response.status,
        statusText: response.statusText,
        body: data
      };
    })();
    console.log('✅ Health response:', JSON.stringify(healthResponse, null, 2));
    console.log('');

    // Test 2: Login endpoint
    console.log('🔐 Testing /login endpoint...');
    actionLog.push('Posted to /login endpoint with admin credentials');
    const loginResponse = await (async () => {
      const response = await fetch(BASE_URL + '/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'admin',
          password: 'password'
        })
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
      return {
        status: response.status,
        statusText: response.statusText,
        body: data
      };
    })();
    console.log('✅ Login response:', JSON.stringify(loginResponse, null, 2));
    const token = loginResponse.body.customToken;
    console.log('');

    // Test 3: Analyze-grievance endpoint
    console.log('📝 Testing /analyze-grievance endpoint...');
    actionLog.push('Posted to /analyze-grievance endpoint with Bearer token and test grievance');
    const grievanceResponse = await (async () => {
      const response = await fetch(BASE_URL + '/analyze-grievance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          grievance: 'I was unfairly dismissed from my job without proper notice or compensation. I have been with the company for 5 years and believe I was targeted due to my age.'
        })
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
      return {
        status: response.status,
        statusText: response.statusText,
        body: data
      };
    })();
    console.log('✅ Analyze-grievance response:', JSON.stringify(grievanceResponse, null, 2));
    console.log('');

    console.log('🏁 All tests completed successfully.');
    console.log('\n📋 Action Log (for reference - no undo needed as these are read-only operations):');
    actionLog.forEach((action, index) => {
      console.log(`${index + 1}. ${action}`);
    });

  } catch (error) {
    console.error('❌ Error during testing:', error);
  }
})();
const express = require('express');
const app = express();
const PORT = 9999;

let submitted = false;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  submitted = false;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Fake Job Application - Test</title></head>
<body>
<h1>Apply: Software Engineer Intern at TestCorp</h1>
<form id="application-form" method="POST" action="/submit" enctype="multipart/form-data">

  <label for="firstName">First Name</label>
  <input type="text" id="firstName" name="firstName" autocomplete="given-name" required />

  <label for="lastName">Last Name</label>
  <input type="text" id="lastName" name="lastName" autocomplete="family-name" required />

  <label for="email">Email Address</label>
  <input type="email" id="email" name="email" autocomplete="email" required />

  <label for="phone">Phone Number</label>
  <input type="tel" id="phone" name="phone" autocomplete="tel" />

  <label for="resume">Resume / CV</label>
  <input type="file" id="resume" name="resume" accept=".pdf,.doc,.docx" />

  <label for="linkedin">LinkedIn Profile</label>
  <input type="url" id="linkedin" name="linkedin" placeholder="https://linkedin.com/in/..." />

  <label for="github">GitHub Profile</label>
  <input type="url" id="github" name="github" placeholder="https://github.com/..." />

  <label for="whyRole">Why do you want this role?</label>
  <textarea id="whyRole" name="whyRole" rows="4"></textarea>

  <label for="yearsExperience">Years of experience</label>
  <input type="number" id="yearsExperience" name="yearsExperience" />

  <label for="workAuth">Work authorization</label>
  <select id="workAuth" name="workAuth">
    <option value="">Select...</option>
    <option value="authorized">Authorized to work</option>
    <option value="sponsorship">Need sponsorship</option>
  </select>

  <label for="aboutYou">About you</label>
  <textarea id="aboutYou" name="aboutYou" rows="3" placeholder="Tell us about yourself"></textarea>

  <label for="additionalInfo">Additional information</label>
  <textarea id="additionalInfo" name="additionalInfo" rows="3"></textarea>

  <br/><br/>
  <button type="submit" id="submit-btn">Submit Application</button>
</form>
</body>
</html>`);
});

app.post('/submit', (req, res) => {
  submitted = true;
  res.send('Application submitted! (This is a test page)');
});

app.get('/submission-status', (req, res) => {
  res.json({ submitted });
});

app.get('/reset', (req, res) => {
  submitted = false;
  res.json({ reset: true });
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Fake job site running on http://127.0.0.1:${PORT}`);
  });
}

module.exports = app;

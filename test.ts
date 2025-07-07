/**
 * Copyright 2025 Mike Odnis
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const axios = require('axios');

// GitHub API Token
const GITHUB_TOKEN = '  '; // Make sure this is securely stored

// Repository info (for the organization repository)
const REPO_OWNER = '';  // Organization name
const REPO_NAME = '';  // Repository name

// GitHub API base URL
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`;

// Function to create an issue
async function createGitHubIssue(issueTitle: string, issueBody: string) {
  try {
    const response = await axios.post(
      GITHUB_API_URL,
      {
        title: issueTitle,
        body: issueBody,
      },
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );
    console.log(`Issue created: ${response.data.html_url}`);
  } catch (error) {
    console.error(`Error creating issue: ${(error as Error).message}`);
    throw new Error(`${error instanceof Error} ? ${(error as Error).message} : 'Error creating issue'`)
  }
}

// Project goals and tasks organized by week for "GDG on Campus Farmingdale State College"
const projectPlan = [
  {
    week: 'Week 1',
    goal: 'Finalize project scope and requirements, research technologies, and develop initial wireframes for the GDG platform.',
    tasks: [
      'Finalize project scope and requirements',
      'Research Next.js, Framer Motion, TypeScript, and component libraries',
      'Develop initial UI/UX wireframes for the website'
    ],
  },
  {
    week: 'Week 2',
    goal: 'Set up the development environment and begin implementing core features like member directory and frontend components.',
    tasks: [
      'Set up Next.js development environment',
      'Develop member directory service (API or microservice)',
      'Implement basic frontend components using Framer Motion and TypeScript'
    ],
  },
  {
    week: 'Week 3',
    goal: 'Refine user experience, ensure backend/frontend integration, and start testing.',
    tasks: [
      'Refine frontend components and UX using Framer Motion',
      'Ensure integration between frontend and backend (member directory)',
      'Begin testing core features (member directory, frontend components)'
    ],
  },
  {
    week: 'Week 4',
    goal: 'Finalize features and prepare for project deployment and review.',
    tasks: [
      'Finalize and polish the member directory and frontend',
      'Prepare project demo and deployment plan',
      'Deploy website and ensure smooth user experience'
    ],
  },
];

// Function to create issues for each task in the project plan
async function createProjectIssues() {
  for (const week of projectPlan) {
    // Create the main issue for the week's goal
    await createGitHubIssue(week.week, week.goal);
    
    // Create individual issues for each task in the week
    for (const task of week.tasks) {
      const issueTitle = `${week.week}: ${task}`;
      const issueBody = `Task for ${week.week}: ${task}`;
      await createGitHubIssue(issueTitle, issueBody);
    }
  }
}

// Run the function to create issues
createProjectIssues();


// Script to extract internship application links that are at most 30 days old
// Run this in browser console on the GitHub page

/**
 * Extracts internship application links that are at most 30 days old
 * from the job listings table on the GitHub README page.
 *
 * @returns {Object} An object containing detailed info and an array of links
 * @see https://github.com/SimplifyJobs/Summer2026-Internships/blob/dev/README-Off-Season.md
*/
function extractRecentInternshipLinks() {
  // Select the table
  const table = document.querySelector('table');
  
  if (!table) {
    console.error('Table not found');
    return;
  }

  const rows = table.querySelectorAll('tbody tr');
  const results = [];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    
    // Check if this is a valid data row (has cells)
    if (cells.length === 0) return;

    // Get the age from the last cell
    const ageCell = cells[cells.length - 1];
    const ageText = ageCell.textContent.trim();
    
    // Parse age (e.g., "0d", "15d", "1mo")
    let dayAge = null;
    
    if (ageText.includes('d')) {
      // Extract number of days
      dayAge = parseInt(ageText);
    } else if (ageText.includes('mo')) {
      // Convert months to days (skip these as they're > 30 days)
      dayAge = parseInt(ageText) * 30;
    }

    // Only process if age is 30 days or less
    if (dayAge !== null && dayAge <= 30) {
      // Get company name
      const companyCell = cells[0];
      const companyName = companyCell.textContent.trim();
      
      // Get role
      const roleCell = cells[1];
      const roleName = roleCell.textContent.trim();
      
      // Get location
      const locationCell = cells[2];
      const location = locationCell.textContent.trim();
      
      // Get application link
      const applicationCell = cells[4];
      const link = applicationCell.querySelector('a');
      
      if (link) {
        const url = link.href;
        
        results.push({
          age: ageText,
          company: companyName,
          role: roleName,
          location: location,
          link: url
        });
      }
    }
  });

  // Sort by age (newest first)
  results.sort((a, b) => {
    const ageA = parseInt(a.age) || 0;
    const ageB = parseInt(b.age) || 0;
    return ageA - ageB;
  });
  
  // Group by age
  const grouped = {};
  results.forEach(item => {
    if (!grouped[item.age]) {
      grouped[item.age] = [];
    }
    grouped[item.age].push(item);
  });

  // Also return just the links as an array
  const linksList = results.map(item => item.link);  

  return {
    detailed: results,
    links: linksList
  };
}

// Run the function
const data = extractRecentInternshipLinks();
console.log(data.links);
// To copy all links to clipboard (if supported):
copy(data.links.join('\n'));
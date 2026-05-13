const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Recursively find all .html files
const getAllHtmlFiles = (dir, files = []) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllHtmlFiles(fullPath, files);
    } else if (entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }
  return files;
};

const validateJsonLd = (htmlContent, filePath) => {
  const $ = cheerio.load(htmlContent);
  const scripts = $('script[type="application/ld+json"]');
  const errors = [];

  if (scripts.length === 0) {
    return []; // No JSON-LD in this file — that's okay
  }

  scripts.each((i, el) => {
    const jsonText = $(el).html();
    if (!jsonText || jsonText.trim() === '') {
      errors.push(`${filePath}: Empty JSON-LD script tag found`);
      return;
    }

    try {
      const data = JSON.parse(jsonText);

      // Basic structural checks
      if (!data['@context']) {
        errors.push(`${filePath}: Missing "@context" in JSON-LD`);
      }
      if (!data['@type']) {
        errors.push(`${filePath}: Missing "@type" in JSON-LD`);
      }

      // Optional: Check for common required fields based on type
      if (data['@type'] === 'Organization' && !data.name) {
        errors.push(`${filePath}: Organization schema is missing "name"`);
      }
      if (data['@type'] === 'WebSite' && !data.url) {
        errors.push(`${filePath}: WebSite schema is missing "url"`);
      }

    } catch (e) {
      errors.push(`${filePath}: Invalid JSON in JSON-LD block — ${e.message}`);
    }
  });

  return errors;
};

const main = () => {
  console.log('🔍 Validating JSON-LD in all HTML files...\n');

  const htmlFiles = getAllHtmlFiles(process.cwd());
  let totalErrors = 0;

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const errors = validateJsonLd(content, file);

    if (errors.length > 0) {
      totalErrors += errors.length;
      errors.forEach(err => console.error('❌ ' + err));
    }
  }

  if (totalErrors === 0) {
    console.log('\n✅ All JSON-LD blocks are valid!');
    process.exit(0);
  } else {
    console.log(`\n❌ Found ${totalErrors} error(s) in JSON-LD.`);
    process.exit(1);
  }
};

main();

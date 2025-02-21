/****************************************************
 * server.js
 * A dynamic Express server for Census data with
 * advanced grouping, normalized keys, and "X"/"NA"/"S"
 * values converted to null.
 ****************************************************/
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

/**
 * Normalize a key by converting it to lowercase,
 * removing commas and parentheses, replacing spaces (and dashes) with underscores.
 *
 * Example: "Population per square mile, 2020" -> "population_per_square_mile_2020"
 */
function normalizeKey(key) {
  return key.toLowerCase()
    .replace(/[,\(\)]/g, "")  // remove commas and parentheses
    .replace(/\s+/g, "_")     // replace whitespace with underscores
    .replace(/-+/g, "_")      // replace hyphens with underscores
    .trim();
}

// -----------------------------------------------------
// Helper: Read JSON file synchronously
// -----------------------------------------------------
function getDataFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const rawData = fs.readFileSync(filePath, "utf8");
    return JSON.parse(rawData);
  } catch (error) {
    console.error("Error reading file:", filePath, error);
    return null;
  }
}

// -----------------------------------------------------
// Transformation function:
// 1. Extract main keys (population, age, race)
// 2. Group remaining keys into logical sub–categories
// 3. Normalize all keys to snake_case
// -----------------------------------------------------
function transformCensusDataDeep(rawData) {
  // Utility to parse a value into a number if possible.
  // If the value is "X", "NA", or "S", return null.
  const parseNumber = (value) => {
    if (!value) return null;
    const trimmed = value.trim().toUpperCase();
    if (trimmed === "X" || trimmed === "NA" || trimmed === "S") return null;
    const num = Number(value.replace(/,/g, ""));
    return isNaN(num) ? null : num;
  };

  // ---------------------------
  // 1. Main Groups Extraction
  // ---------------------------
  let populationCensus2010 = null,
      populationCensus2020 = null;
  let populationEst2023 = null,
      populationEst2024 = null;
  let popChange2023 = null,
      popChange2024 = null;
  let ageUnder5 = null,
      ageUnder18 = null,
      ageOver65 = null;
  let race = {};

  // Patterns for race keys
  const racePatterns = [
    { key: "White alone, not Hispanic", pattern: "White alone, not Hispanic" },
    { key: "White alone", pattern: "White alone" },
    { key: "Black alone", pattern: "Black alone" },
    { key: "American Indian and Alaska Native", pattern: "American Indian and Alaska Native" },
    { key: "Asian alone", pattern: "Asian alone" },
    { key: "Native Hawaiian and Other Pacific Islander", pattern: "Native Hawaiian" },
    { key: "Two or More Races", pattern: "Two or More Races" },
    { key: "Hispanic or Latino", pattern: "Hispanic or Latino" }
  ];

  Object.values(rawData).forEach(item => {
    const label = item.label;
    const value = item.value;
    
    // Population Census numbers
    if (label.includes("Population, Census, April 1, 2010")) {
      populationCensus2010 = parseNumber(value);
      return;
    }
    if (label.includes("Population, Census, April 1, 2020")) {
      populationCensus2020 = parseNumber(value);
      return;
    }
    // Population estimates (for bar charts)
    if (label.includes("Population estimates, July 1, 2023")) {
      populationEst2023 = parseNumber(value);
      return;
    }
    if (label.includes("Population estimates, July 1, 2024")) {
      populationEst2024 = parseNumber(value);
      return;
    }
    // Population change percentages
    if (label.includes("Population, percent change") && label.includes("July 1, 2023")) {
      popChange2023 = parseNumber(value);
      return;
    }
    if (label.includes("Population, percent change") && label.includes("July 1, 2024")) {
      popChange2024 = parseNumber(value);
      return;
    }
    // Age distribution
    if (label.includes("Persons under 5 years, percent")) {
      ageUnder5 = parseNumber(value);
      return;
    }
    if (label.includes("Persons under 18 years, percent")) {
      ageUnder18 = parseNumber(value);
      return;
    }
    if (label.includes("Persons 65 years and over, percent")) {
      ageOver65 = parseNumber(value);
      return;
    }
    // Race distribution: iterate over defined patterns
    for (let r of racePatterns) {
      if (label.includes(r.pattern)) {
        race[normalizeKey(r.key)] = parseNumber(value);
        return;
      }
    }
    // Other keys will be grouped below.
  });

  // -----------------------------------------
  // 2. Grouping Remaining Fields into Categories
  // -----------------------------------------
  // List of patterns that have already been processed:
  const processedPatterns = [
    "Population, Census, April 1, 2010",
    "Population, Census, April 1, 2020",
    "Population estimates, July 1, 2023",
    "Population estimates, July 1, 2024",
    "Population, percent change",
    "Persons under 5 years, percent",
    "Persons under 18 years, percent",
    "Persons 65 years and over, percent",
    "White alone",
    "Black alone",
    "American Indian and Alaska Native",
    "Asian alone",
    "Native Hawaiian",
    "Two or More Races",
    "Hispanic or Latino"
  ];
  const isProcessed = (label) => {
    return processedPatterns.some(pattern => label.includes(pattern));
  };

  // Initialize our grouped categories with snake_case keys:
  const miscGroups = {
    population_base: {},
    demographics: {},
    housing: {},
    education: {},
    health: {},
    labor_economics: {},
    business: {},
    geographic: {},
    other: {}
  };

  // Process each raw item that wasn’t captured above.
  Object.values(rawData).forEach(item => {
    const label = item.label;
    if (isProcessed(label)) return; // skip if already processed
    const value = parseNumber(item.value);

    if (label.includes("Population estimates base")) {
      miscGroups.population_base[normalizeKey(label)] = value;
    } else if (label.includes("Female persons") ||
               label.includes("Veterans,") ||
               label.includes("Foreign-born persons")) {
      miscGroups.demographics[normalizeKey(label)] = value;
    } else if (label.includes("Housing Units") ||
               label.includes("Owner-occupied housing unit rate") ||
               label.includes("Median value of owner-occupied housing units") ||
               label.includes("Median selected monthly owner costs") ||
               label.includes("Median gross rent") ||
               label.includes("Building Permits") ||
               label.includes("Households,") ||
               label.includes("Persons per household") ||
               label.includes("Living in the same house")) {
      miscGroups.housing[normalizeKey(label)] = value;
    } else if (label.includes("Language other than English") ||
               label.includes("Households with a computer") ||
               label.includes("Households with a broadband Internet subscription") ||
               label.includes("High school graduate") ||
               label.includes("Bachelor's degree")) {
      miscGroups.education[normalizeKey(label)] = value;
    } else if (label.includes("With a disability") ||
               label.includes("health insurance") ||
               label.includes("Persons in poverty")) {
      miscGroups.health[normalizeKey(label)] = value;
    } else if (label.includes("In civilian labor force") ||
               label.includes("Total accommodation and food services sales") ||
               label.includes("Total health care and social assistance") ||
               label.includes("Total transportation and warehousing") ||
               label.includes("Total retail sales") ||
               label.includes("Mean travel time to work") ||
               label.includes("Median households income") ||
               label.includes("Per capita income")) {
      miscGroups.labor_economics[normalizeKey(label)] = value;
    } else if (label.includes("employer") ||
               label.includes("employment") ||
               label.includes("payroll") ||
               label.includes("firms")) {
      miscGroups.business[normalizeKey(label)] = value;
    } else if (label.includes("Population per square mile") ||
               label.includes("Land area in square miles") ||
               label.includes("FIPS Code")) {
      miscGroups.geographic[normalizeKey(label)] = value;
    } else {
      miscGroups.other[normalizeKey(label)] = value;
    }
  });

  // ------------------------------------------------------
  // 3. Build the Final Output Object (all keys in snake_case)
  // ------------------------------------------------------
  const result = {
    population_census: {
      "2010": populationCensus2010,
      "2020": populationCensus2020
    },
    population_estimates: {},
    population_change: {},
    age_distribution: {},
    race_distribution: race,
    miscellaneous: miscGroups
  };

  if (populationEst2023 !== null) result.population_estimates["2023"] = populationEst2023;
  if (populationEst2024 !== null) result.population_estimates["2024"] = populationEst2024;

  if (popChange2023 !== null || popChange2024 !== null) {
    if (popChange2023 !== null) result.population_change["2023"] = popChange2023;
    if (popChange2024 !== null) result.population_change["2024"] = popChange2024;
  }

  // Compute age distribution remainder so that the percentages sum to 100
  const under5 = ageUnder5 !== null ? ageUnder5 : 0;
  const under18 = ageUnder18 !== null ? ageUnder18 : 0;
  const over65 = ageOver65 !== null ? ageOver65 : 0;
  const totalAge = under5 + under18 + over65;
  const otherAge = totalAge <= 100 ? 100 - totalAge : 0;
  result.age_distribution = {
    under5,
    under18,
    over65,
    other: otherAge
  };

  return result;
}

// -----------------------------------------------------
// Dynamic Endpoint:
//   - If identifier is a two-letter state code, it will
//     load from data/states/XX.json.
//   - Otherwise, it loads from data/mi_cities/identifier.json.
// -----------------------------------------------------
app.get("/api/:identifier", (req, res) => {
  const { identifier } = req.params;
  let filePath = "";
  if (identifier.length === 2 && /^[A-Za-z]{2}$/.test(identifier)) {
    filePath = path.join(__dirname, "data", "states", `${identifier.toUpperCase()}.json`);
  } else {
    filePath = path.join(__dirname, "data", "mi_cities", `${identifier.toLowerCase()}.json`);
  }
  const rawData = getDataFromFile(filePath);
  if (!rawData) return res.status(404).json({ error: "Data not found" });
  const transformed = transformCensusDataDeep(rawData);
  res.json(transformed);
});

// -----------------------------------------------------
// Additional Endpoints to List Available Files
// -----------------------------------------------------
app.get("/api/list/cities", (req, res) => {
  const dirPath = path.join(__dirname, "data", "mi_cities");
  try {
    const files = fs.readdirSync(dirPath);
    const cities = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
    res.json({ cities });
  } catch (error) {
    res.status(500).json({ error: "Unable to read cities directory" });
  }
});

app.get("/api/list/states", (req, res) => {
  const dirPath = path.join(__dirname, "data", "states");
  try {
    const files = fs.readdirSync(dirPath);
    const states = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
    res.json({ states });
  } catch (error) {
    res.status(500).json({ error: "Unable to read states directory" });
  }
});

// -----------------------------------------------------
// Start the Server
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Census API server is running on port ${PORT}`);
});
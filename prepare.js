/**
 * Link Sync Script for minweb-public-data
 * 
 * This script processes a list of links to extract metadata, images, and colors.
 * It includes several robustness improvements to prevent CI timeouts:
 * 
 * Features:
 * - Timeout protection for unfurl operations (30s) and image fetching (10s)
 * - Overall process timeout (5 hours) to prevent CI failures
 * - Progress tracking and logging
 * - Skip recently processed items (within 24 hours) for efficiency
 * - Graceful error handling with fallback values
 * - Reduced concurrency (3 instead of 5) for stability
 * 
 * Usage:
 * - npm run sync                 (normal mode, skips recent items)
 * - node prepare.js --force-all  (force mode, processes all items)
 */

import fs from "fs";
import { unfurl } from "unfurl.js";
import axios from "axios";
import { getDominantColor, rgbColorToCssString } from "@unpic/placeholder";
import { getPixels } from "@unpic/pixels";
import pMap from "p-map";
import sizeOf from "image-size";

// Timeout wrapper for promises
function withTimeout(promise, timeoutMs, operation = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

async function getFallbackColor(url) {
  const { data } = await getPixels(url);
  return rgbColorToCssString(getDominantColor(data));
}

async function getImageResolution() {}

function readFile() {
  const data = fs.readFileSync("./data/links.json", "utf8");
  const parsedData = JSON.parse(data);
  return parsedData;
}

async function getLink(item, index, total) {
  console.log(`Processing ${index + 1}/${total}: ${item.title} - ${item.link}`);
  const link = item.link;
  const title = item.title;
  const fallbackImage =
    "https://og.barelyhuman.xyz/generate?fontSize=14&backgroundColor=%23121212&title=" +
    title +
    "&fontSizeTwo=8&color=%23efefef";

  try {
    // Add timeout to unfurl operation (30 seconds)
    const result = await withTimeout(
      unfurl(link),
      30000,
      `unfurl for ${link}`
    );
    
    let imageLink = fallbackImage;
    if (result.open_graph?.images?.length > 0) {
      imageLink =
        result.open_graph.images[0].secure_url ||
        result.open_graph.images[0].url;
    }

    let imageDimensions = {};
    const valid = await axios
      .get(imageLink, {
        timeout: 10000, // Increased from 5s to 10s
        responseType: "arraybuffer",
      })
      .then((d) => {
        imageDimensions = sizeOf(Buffer.from(d.data));
        return true;
      })
      .catch((err) => {
        console.log(`Failed to fetch image ${imageLink}:`, err.message);
        return false;
      });

    if (!valid) {
      imageLink = fallbackImage;
      // Get dimensions for fallback image
      try {
        const fallbackResponse = await axios.get(imageLink, {
          timeout: 10000,
          responseType: "arraybuffer",
        });
        imageDimensions = sizeOf(Buffer.from(fallbackResponse.data));
      } catch (err) {
        console.log(`Failed to fetch fallback image dimensions:`, err.message);
        imageDimensions = { width: 1200, height: 630, type: "png" }; // Default dimensions
      }
    }

    item.dimensions = imageDimensions;
    item.imageURL = imageLink;
    item.addedOn = item.addedOn ?? new Date().toISOString();
    
    // Add timeout to color extraction (15 seconds)
    try {
      item.backgroundColor = await withTimeout(
        getFallbackColor(imageLink),
        15000,
        `color extraction for ${imageLink}`
      );
    } catch (err) {
      console.log(`Failed to get background color for ${imageLink}:`, err.message);
      item.backgroundColor = "rgb(18,18,18)"; // Default dark background
    }
    
    return item;
  } catch (err) {
    console.log(`Error processing ${link}:`, err.message);
    item.imageURL = fallbackImage;
    item.dimensions = { width: 1200, height: 630, type: "png" }; // Default dimensions
    item.backgroundColor = "rgb(18,18,18)"; // Default dark background
    item.addedOn = item.addedOn ?? new Date().toISOString();
    return item;
  }
}

async function prepareLinks() {
  const startTime = Date.now();
  const maxRuntime = 5 * 60 * 60 * 1000; // 5 hours max runtime (1 hour buffer before CI timeout)
  const forceAll = process.argv.includes('--force-all');
  
  console.log("Starting link preparation process...");
  if (forceAll) {
    console.log("Force mode: processing all items regardless of last update time");
  }
  
  const data = readFile();
  console.log(`Found ${data.length} total links`);
  
  const uniqueData = [];
  data.reduce((acc, item) => {
    if (acc.has(item.link)) return acc;
    acc.add(item.link);
    uniqueData.push(item);
    return acc;
  }, new Set());
  
  console.log(`Processing ${uniqueData.length} unique links`);
  
  // Filter out recently processed items (within last 24 hours) to save time on repeated runs
  let itemsToProcess = uniqueData;
  if (!forceAll) {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    itemsToProcess = uniqueData.filter(item => {
      if (!item.addedOn) return true; // Always process items without addedOn
      const addedTime = new Date(item.addedOn).getTime();
      const shouldReprocess = addedTime < oneDayAgo;
      if (!shouldReprocess) {
        console.log(`Skipping recently processed item: ${item.title}`);
      }
      return shouldReprocess;
    });
    
    if (itemsToProcess.length !== uniqueData.length) {
      console.log(`Skipping ${uniqueData.length - itemsToProcess.length} recently processed items`);
      console.log(`Processing ${itemsToProcess.length} items that need updates`);
    }
  }
  
  // Add progress tracking and timeout to the mapping process
  const processWithTimeout = async (items) => {
    let processed = 0;
    return await pMap(
      items, 
      async (item, index) => {
        // Check if we're approaching timeout
        const elapsed = Date.now() - startTime;
        if (elapsed > maxRuntime) {
          throw new Error(`Process timeout: exceeded ${maxRuntime / 1000 / 60} minutes`);
        }
        
        try {
          const result = await getLink(item, index, items.length);
          processed++;
          if (processed % 10 === 0) {
            console.log(`Progress: ${processed}/${items.length} items processed (${((processed/items.length)*100).toFixed(1)}%)`);
          }
          return result;
        } catch (err) {
          console.log(`Failed to process item ${index + 1}: ${err.message}`);
          // Return item with minimal fallback data
          return {
            ...item,
            imageURL: `https://og.barelyhuman.xyz/generate?fontSize=14&backgroundColor=%23121212&title=${encodeURIComponent(item.title)}&fontSizeTwo=8&color=%23efefef`,
            backgroundColor: "rgb(18,18,18)",
            dimensions: { width: 1200, height: 630, type: "png" },
            addedOn: item.addedOn ?? new Date().toISOString()
          };
        }
      }, 
      {
        concurrency: 3, // Reduced from 5 to be more conservative
      }
    );
  };

  // If no items need processing, return the existing data
  if (itemsToProcess.length === 0) {
    console.log("All items are up to date, no processing needed");
    return;
  }

  const processedItems = await withTimeout(
    processWithTimeout(itemsToProcess),
    maxRuntime,
    "entire link processing"
  );
  
  // Merge processed items back with unprocessed items
  const finalCollection = uniqueData.map(originalItem => {
    const processedItem = processedItems.find(processed => processed.link === originalItem.link);
    return processedItem || originalItem;
  });
  
  console.log(`Successfully processed ${processedItems.length} links`);
  fs.writeFileSync("data/links.json", JSON.stringify(finalCollection, null, 2));
  
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`Process completed in ${totalTime.toFixed(2)} seconds`);
}

prepareLinks()
  .then((d) => {
    console.log("✅ Link preparation completed successfully");
    process.exit(0);
  })
  .catch((d) => {
    console.error("❌ Link preparation failed:", d.message);
    console.error("Full error details:", d);
    process.exit(1);
  });

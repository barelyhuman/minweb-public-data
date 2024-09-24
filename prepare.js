import fs from "fs";
import { unfurl } from "unfurl.js";
import axios from "axios";
import { getDominantColor, rgbColorToCssString } from "@unpic/placeholder";
import { getPixels } from "@unpic/pixels";
import pMap from "p-map";
import sizeOf from "image-size";

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

async function getLink(item) {
  console.log("Processing", item.title, item.link);
  const link = item.link;
  const title = item.title;
  const fallbackImage =
    "https://og.barelyhuman.xyz/generate?fontSize=14&backgroundColor=%23121212&title=" +
    title +
    "&fontSizeTwo=8&color=%23efefef";

  try {
    const result = await unfurl(link);
    let imageLink = fallbackImage;
    if (result.open_graph?.images?.length > 0) {
      imageLink =
        result.open_graph.images[0].secure_url ||
        result.open_graph.images[0].url;
    }

    let imageDimensions = {};
    const valid = await axios
      .get(imageLink, {
        timeout: 5000,
        responseType: "arraybuffer",
      })
      .then((d) => {
        imageDimensions = sizeOf(Buffer.from(d.data));
        return true;
      })
      .catch((d) => {
        return false;
      });

    if (!valid) {
      imageLink = fallbackImage;
    }

    item.dimensions = imageDimensions;
    item.imageURL = imageLink;
    item.addedOn = item.addedOn ?? new Date().toISOString();
    item.backgroundColor = await getFallbackColor(imageLink);
    return item;
  } catch (err) {
    console.log({ err });
    item.imageURL = fallbackImage;
    return item;
  }
}

async function prepareLinks() {
  const data = readFile();
  const uniqueData = [];
  data.reduce((acc, item) => {
    if (acc.has(item.link)) return acc;
    acc.add(item.link);
    uniqueData.push(item);
    return acc;
  }, new Set());
  const collection = await pMap(uniqueData, getLink, {
    concurrency: 5,
  });
  fs.writeFileSync("data/links.json", JSON.stringify(collection, null, 2));
}

prepareLinks()
  .then((d) => {
    process.exit(0);
  })
  .catch((d) => {
    console.error(d);
    process.exit(1);
  });

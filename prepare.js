const fs = require("fs");
const { unfurl } = require("unfurl.js");
const axios = require("axios");

function readFile() {
  const data = fs.readFileSync("./data/links.json", "utf8");
  const parsedData = JSON.parse(data);
  return parsedData;
}

const serialMap = async (collection, mapper) => {
  let resultCollection = [];
  await collection.reduce((acc, item) => {
    return acc
      .then((_) => mapper(item))
      .then((result) => {
        resultCollection.push(result);
      });
  }, Promise.resolve());
  return resultCollection;
};

async function getLink(item) {
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

    const valid = await axios
      .get(imageLink)
      .then((d) => true)
      .catch((d) => {
        return false;
      });

    if (!valid) {
      imageLink = fallbackImage;
    }

    item.imageURL = imageLink;
    return item;
  } catch (err) {
    console.log({ err });
    item.imageURL = fallbackImage;
    return item;
  }
}

async function prepareLinks() {
  const data = readFile();
  const collection = await serialMap(data, getLink);
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

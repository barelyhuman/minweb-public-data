# minweb-public-data

This repository holds the static data used by
[minweb.site](https://minweb.site), and is left open to be used for building
more clients for the same use case.

## Add another site

To submit another website to the list, just add it at the end of the
`data/links.json` file.

Fill in just the following fields, `imageURL` will be generated from your
website or a fallback will be generated if it's unable to do so.

```json5
{
  "title": "Name",
  "link": "https://example.com/",
  "category": "personal" // personal | company | blog
}
```

## License

[MIT](/LICENSE)

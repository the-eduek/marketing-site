import { marked } from "marked";

const TYPES = {
  articles: {
    markdown: ["content"],
  },
};

const tableOfContents = (html) => {
  const toc = [];
  var level = 0;

  html.replace(
    /<h([1-6]) id="([^"]+)">([^<]+)<\/h([1-6])>/g,
    function (match, _level, id, text) {
      _level = parseInt(_level, 10);
      while (level > _level) {
        level--;
      }
      while (level < _level) {
        level++;
      }
      toc.push({ id, level, text });
    }
  );

  return toc;
};

function createIndentedList(items) {
  let html = "";
  let currentLevel = 1;
  let stack = [];
  for (const item of items) {
    const { id, level, text } = item;
    while (level < currentLevel) {
      html += `</${stack.pop()}>`;
      currentLevel--;
    }
    while (level > currentLevel) {
      html += `<ol><li>`;
      stack.push("ol");
      currentLevel++;
    }
    if (level === currentLevel) {
      html += `</li><li><a href="#${id}">${text}</a>`;
    } else {
      html += `<li><a href="#${id}">${text}</a>`;
    }
  }
  while (stack.length > 0) {
    html += `</${stack.pop()}>`;
  }

  // Remove empty list items
  html = html.replace(/<li><\/li>/g, "");
  html = html.replace(/<\/a><\/ol>/g, "</a></li></ol>");

  return html;
}

const convert = (data, { indexAfterParagraph = 0, showIndex = false } = {}) => {
  let html = marked(data, {
    headerIds: true,
  });

  // Replace external links with target="_blank"
  html = html.replace(
    /<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g,
    function (match, href, attributes, text) {
      const url = new URL(href);
      if (url.hostname === "www.simpleanalytics.com") {
        const path = href.split("/").slice(3).join("/");
        return `<a href="/${path}"${attributes}>${text}</a>`;
      }
      if (
        href.startsWith("http") &&
        !url.hostname.includes("simpleanalytics")
      ) {
        return `<a href="${href}"${attributes} target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
      }
      return match;
    }
  );

  if (!showIndex) return html;

  const toc = tableOfContents(html);

  if (toc.length === 0) return html;

  const index = createIndentedList(toc).replace(
    "<ol>",
    '<ol class="counters">'
  );

  if (indexAfterParagraph > 0) {
    const paragraphs = html.match(/<p>([^<]+)<\/p>/g);
    if (paragraphs && paragraphs.length >= indexAfterParagraph) {
      const paragraph = paragraphs[indexAfterParagraph - 1];
      return html.replace(paragraph, `${paragraph}${index}`);
    }
  }

  // Check if paragraph before <h2> is less than 100 characters
  if (html.match(/<p>([^<]{0,100})<\/p>\n<h2/))
    return html.replace(/(<p>([^<]{0,100})<\/p>\n)<h2/, `${index}$1<h2`);

  // Insert before first <h2> if it exists
  if (html.match(/<h2/)) return html.replace(/<h2/, `${index}$1<h2`);

  return `${index}${html}`;
};

const parse = ({ type, response }) => {
  response.data = response.data.map((item) => {
    for (const iterator of TYPES[type].markdown) {
      if (item.attributes[iterator]) {
        item.attributes[iterator + "Html"] = convert(
          item.attributes[iterator],
          item.attributes
        );
      }
    }

    if (item.attributes.localizations.data.length > 0) {
      item.attributes.localizations.data.forEach((localization) => {
        for (const iterator of TYPES[type].markdown) {
          if (localization.attributes[iterator]) {
            localization.attributes[iterator + "Html"] = convert(
              localization.attributes[iterator],
              item.attributes
            );
          }
        }
      });
    }

    return item;
  });

  return response;
};

export default defineEventHandler(async (event) => {
  const { strapiToken } = useRuntimeConfig();

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${strapiToken}`,
  };

  const url = new URL(event.node?.req.url, "https://cms.simpleanalytics.com");

  const path = url.searchParams.get("path");
  const type = path.slice(1);

  url.pathname = "/api" + path;
  url.searchParams.delete("path");

  if (!path || !TYPES[type]) throw new Error("Not allowed");

  const response = await $fetch(url, { method: "GET", headers });

  return parse({ type, response });
});

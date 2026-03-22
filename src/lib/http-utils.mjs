import http from "node:http";
import https from "node:https";
import { APP_CONFIG } from "../../config/project.config.mjs";

const DEFAULT_TIMEOUT_MS = APP_CONFIG.network.defaultTimeoutMs;
const DEFAULT_MAX_REDIRECTS = APP_CONFIG.network.defaultMaxRedirects;

export function fetchText(url, options = {}) {
  const {
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS
  } = options;

  return new Promise((resolve, reject) => {
    requestRaw(
      url,
      { headers, timeoutMs, maxRedirects },
      (response) => resolve(response.body),
      reject
    );
  });
}

export async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, options);
  return JSON.parse(response.body);
}

export function fetchResponse(url, options = {}) {
  const {
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS
  } = options;

  return new Promise((resolve, reject) => {
    requestRaw(url, { headers, timeoutMs, maxRedirects }, resolve, reject);
  });
}

function requestRaw(url, options, resolve, reject) {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;

  const request = transport.request(
    target,
    {
      method: "GET",
      headers: options.headers
    },
    (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (options.maxRedirects <= 0) {
          reject(new Error(`Too many redirects while fetching ${url}`));
          return;
        }
        const nextUrl = new URL(location, target).toString();
        requestRaw(
          nextUrl,
          {
            ...options,
            maxRedirects: options.maxRedirects - 1
          },
          resolve,
          reject
        );
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Request failed with status ${statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () =>
        resolve({
          url: target.toString(),
          statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        })
      );
    }
  );

  request.setTimeout(options.timeoutMs, () => {
    request.destroy(new Error(`Request timeout after ${options.timeoutMs}ms`));
  });

  request.on("error", reject);
  request.end();
}

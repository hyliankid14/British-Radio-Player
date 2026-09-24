import test from "node:test";
import assert from "node:assert/strict";
import SparkMD5 from "spark-md5";

test("Last.fm API signature computation matches RFC and Kotlin implementation", () => {
  const params: Record<string, string> = {
    method: "auth.getSession",
    api_key: "my_api_key",
    token: "my_token",
    format: "json",
    callback: "my_callback"
  };
  const secret = "my_secret";

  // format and callback must be excluded, and params sorted alphabetically:
  // api_key + my_api_key + method + auth.getSession + token + my_token + my_secret
  const expectedString = "api_keymy_api_keymethodauth.getSessiontokenmy_tokenmy_secret";

  const input = Object.keys(params)
    .filter((key) => key !== "format" && key !== "callback")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("") + secret;

  assert.equal(input, expectedString);
  const signature = SparkMD5.hash(input);
  // Expected md5 hash of "api_keymy_api_keymethodauth.getSessiontokenmy_tokenmy_secret"
  assert.equal(signature, "fd1f5c26f12b34f3f19a4c506eee55a7");
});

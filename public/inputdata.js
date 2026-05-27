/**
 * Mock inputData — replace with platform-injected data (Art Blocks, fxhash, etc.)
 */
var inputData = {
  hash: "0x" + Array.from({ length: 64 }, function() {
    return Math.floor(Math.random() * 16).toString(16);
  }).join("")
};

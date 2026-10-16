import { test } from "node:test"
import assert from "node:assert/strict"
import { filenameFromDisposition } from "./contentDisposition.ts"

test("RFC 5987 filename* wins and keeps Cyrillic and spaces", () => {
  assert.equal(
    filenameFromDisposition(
      "attachment; filename=\"__________ 3 ______marking.zip\"; filename*=UTF-8''%D0%9A%D0%BE%D0%BD%D1%82%D0%B5%D0%B9%D0%BD%D0%B5%D1%80%203%20%D0%A0%D0%BE%D1%81%D1%82%D0%BE%D0%B2_marking.zip",
      "x.zip"
    ),
    "Контейнер 3 Ростов_marking.zip"
  )
})

test("the older percent-encoded plain filename still works", () => {
  assert.equal(
    filenameFromDisposition('attachment; filename="packing%20list.pdf"', "x"),
    "packing list.pdf"
  )
  assert.equal(filenameFromDisposition("attachment; filename=report.xlsx", "x"), "report.xlsx")
})

test("no header or no name: the fallback", () => {
  assert.equal(filenameFromDisposition(null, "marking.zip"), "marking.zip")
  assert.equal(filenameFromDisposition("attachment", "marking.zip"), "marking.zip")
})

test("a malformed encoding doesn't throw", () => {
  assert.equal(filenameFromDisposition('attachment; filename="100%"', "x"), "100%")
})

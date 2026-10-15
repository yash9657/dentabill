-- Cash-only admission matches CashInputSchema: UTF-16 units, ECMAScript trim,
-- and Unicode Cc/Cf/Cs. Keep migration26 and shared source helpers unchanged.
-- Category ranges: Unicode 17 DerivedGeneralCategory.txt (unchanged from 15/16).
-- https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedGeneralCategory.txt
-- https://tc39.es/ecma262/multipage/text-processing.html#sec-trimstring
BEGIN;

CREATE FUNCTION dentabill_cash_token_valid(value TEXT, maximum INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  characters INTEGER := char_length(value);
  units INTEGER := 0;
  position INTEGER;
  codepoint INTEGER;
BEGIN
  IF value IS NULL OR maximum IS NULL OR characters < 1 OR characters > maximum THEN
    RETURN false;
  END IF;
  FOR position IN 1..characters LOOP
    codepoint := ascii(substr(value,position,1));
    units := units + CASE WHEN codepoint > 65535 THEN 2 ELSE 1 END;
    IF units > maximum THEN RETURN false; END IF;
    IF codepoint BETWEEN 0 AND 31 OR codepoint BETWEEN 127 AND 159
      OR codepoint BETWEEN 55296 AND 57343
      OR codepoint IN (173,1564,1757,1807,2274,6158,65279,69821,69837,917505)
      OR codepoint BETWEEN 1536 AND 1541 OR codepoint BETWEEN 2192 AND 2193
      OR codepoint BETWEEN 8203 AND 8207 OR codepoint BETWEEN 8234 AND 8238
      OR codepoint BETWEEN 8288 AND 8292 OR codepoint BETWEEN 8294 AND 8303
      OR codepoint BETWEEN 65529 AND 65531 OR codepoint BETWEEN 78896 AND 78911
      OR codepoint BETWEEN 113824 AND 113827 OR codepoint BETWEEN 119155 AND 119162
      OR codepoint BETWEEN 917536 AND 917631
    THEN RETURN false; END IF;
    -- Cc/Cf above already rejects tab, CR/LF and BOM anywhere. Remaining JS
    -- whitespace is allowed internally but never at a token's edges.
    IF position IN (1,characters) AND (
      codepoint IN (32,160,5760,8232,8233,8239,8287,12288)
      OR codepoint BETWEEN 8192 AND 8202
    ) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION dentabill_cash_json_token(value JSONB, maximum INTEGER, allow_null BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((allow_null AND value = 'null'::jsonb)
    OR (jsonb_typeof(value) = 'string' AND dentabill_cash_token_valid(value #>> '{}',maximum)),false);
$$;

CREATE FUNCTION dentabill_cash_payload_tokens_valid(payload JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE key TEXT;
BEGIN
  FOREACH key IN ARRAY ARRAY['sourceSystem','sourceProduct'] LOOP
    IF NOT dentabill_cash_json_token(payload->key,80) THEN RETURN false; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['sourceAccountId','sourceTransactionId','sourceRecordId','sourceDocumentId'] LOOP
    IF NOT dentabill_cash_json_token(payload->key,200) THEN RETURN false; END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['sourceVersion','counterpartyName','paymentTrace','pendingSourceTransactionId'] LOOP
    IF NOT dentabill_cash_json_token(payload->key,200,true) THEN RETURN false; END IF;
  END LOOP;
  RETURN dentabill_cash_json_token(payload->'sourceStatus',80,true)
    AND dentabill_cash_json_token(payload->'sourceDescription',500,true);
END;
$$;

ALTER TABLE "CashSourceTransaction" ADD CONSTRAINT "CashSourceTransaction_token_bounds_check" CHECK (
  dentabill_cash_token_valid("sourceSystem",80)
  AND dentabill_cash_token_valid("sourceProduct",80)
  AND dentabill_cash_token_valid("sourceAccountId",200)
  AND dentabill_cash_token_valid("sourceTransactionId",200)
);
ALTER TABLE "CashSourceEvidence" ADD CONSTRAINT "CashSourceEvidence_token_bounds_check" CHECK (
  dentabill_cash_token_valid("sourceAccountId",200)
  AND dentabill_cash_token_valid("sourceRecordId",200)
  AND dentabill_cash_token_valid("sourceDocumentId",200)
  AND ("sourceVersion" IS NULL OR dentabill_cash_token_valid("sourceVersion",200))
  AND dentabill_cash_payload_tokens_valid(payload)
);

COMMIT;

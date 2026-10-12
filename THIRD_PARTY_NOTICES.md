# Third-party notices

LLMpense is licensed under FSL-1.1-ALv2 (see `LICENSE`). The bundled price table
`packages/core/data/prices.json` is compiled by `pnpm prices:sync` from the third-party
price databases below, each used under the MIT License. As the MIT License requires,
their copyright and permission notices are reproduced here. Which source supplied each
row is recorded in the `sources` field of that row.
These notices must ship with any distribution that includes `prices.json`.

---

## LiteLLM price list (`litellm`)

- Project: https://github.com/BerriAI/litellm
- Data used: model_prices_and_context_window.json (repository root; outside `enterprise/`, so under the MIT part of the repository license)
- License file: https://github.com/BerriAI/litellm/blob/main/LICENSE

```
MIT License

Copyright (c) 2023 Berri AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## GenAI Prices (`genai-prices`)

- Project: https://github.com/pydantic/genai-prices
- Data used: prices/new_data/v2/data_slim.json
- License file: https://github.com/pydantic/genai-prices/blob/main/LICENSE

```
The MIT License (MIT)

Copyright (c) Pydantic Services Inc. 2025 to present

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Models.dev (`models.dev`)

- Project: https://github.com/anomalyco/models.dev (formerly sst/models.dev)
- Data used: https://models.dev/api.json, generated from the repository's providers/*/models/*.toml
- License file: https://github.com/anomalyco/models.dev/blob/dev/LICENSE

```
MIT License

Copyright (c) 2025 models.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Portkey Models (`portkey`)

- Project: https://github.com/Portkey-AI/models
- Data used: pricing/openai.json, pricing/anthropic.json, pricing/google.json
- License file: https://github.com/Portkey-AI/models/blob/main/LICENSE

```
MIT License

Copyright (c) 2025 Portkey.ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## ECB euro foreign exchange reference rates

- Source: European Central Bank, https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- Data used: the daily, 90-day and historical XML feeds under https://www.ecb.europa.eu/stats/eurofxref/ (USD, GBP, JPY, CNY and CHF per EUR), fetched at run time by `pnpm fx:sync` and the web app; no rates are bundled. The test fixtures in `packages/core/src/fixtures/` are excerpts of these feeds.
- Terms: https://www.ecb.europa.eu/services/disclaimer/html/index.en.html. Reproduction is permitted provided the information appears accurately and the ECB is cited as the source; modifications must be stated explicitly. The reference rates are published for information purposes only.
- Modification: LLMpense calculates USD cross rates from the euro reference rates (target rate per EUR divided by the USD rate per EUR) and converts and rounds statement amounts with them. Statements that use an ECB rate print the source acknowledgement "Source: European Central Bank, euro foreign exchange reference rates. The USD rate is a cross rate calculated via EUR by LLMpense."

## IBM Plex Sans (statement PDF font)

- Project: https://github.com/IBM/plex
- Files used: `IBMPlexSans-Regular.ttf` and `IBMPlexSans-SemiBold.ttf` in `apps/web/assets/fonts/`, embedded as subsets in the statement PDFs the web app generates.
- License: SIL Open Font License 1.1, Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". The full license text ships next to the fonts in `apps/web/assets/fonts/OFL.txt`.

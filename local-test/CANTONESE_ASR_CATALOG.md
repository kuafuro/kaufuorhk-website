# 廣東話 ASR Model 目錄（2026-07-23 地毯式掃描）

> 方法：6 個角度平行掃 HuggingFace API（官方 `yue` tag／名字搜索／Whisper 系作者／非 Whisper 系／
> 轉換版／評測數據集）＋補漏一輪，共掃出 **509 個唔重複 repo**；再逐個 curl config.json／model card
> 驗證格式同 CER 數。**已驗 80 個 model ＋ 92 個 dataset**；餘下 ~337 個（多數係多語 model 長尾
> 同轉換版）未逐個驗，唔影響下面名單完整性——粵語專項 model 集中喺已驗批次。
>
> ⚠️ **CER 全部係作者自報**，測試集各異（CV11/15/16/17、MDCC、自家 set），**互相唔可以直接比**；
> 有啲低到可疑（疑似 train/test 重疊）。真・排名要用 `compare_models.py` 攞同一條音實測。

## ① 擂台選手（transformers 直接 load 到）

| repo | 參數 | 自報 CER／WER | 訓練數據 | 備註 |
|---|---|---|---|---|
| `alvanlii/whisper-small-cantonese` | 242M (F32 241,734,912) | CER 7.93 (無標點) / 9.72 (有標點) @ Common Voice 16.0 yue test；GPU sdpa 0.055s/sample | Common Voice 16/17 zh-HK+yue (~400h)、Cantonese-ASR (HKUST, 72h)、CantoMap (23h)、自製 pseudo-labelled Yo | 已驗證：downloads 286,353、likes 118，config.json 確認 WhisperForConditionalGeneration。社群事實標準嘅廣東話 Whisper fine-tune，訓練數據最多元（含 438h YouTube pseudo-la |
| `alvanlii/wav2vec2-BERT-cantonese` | 608M (F32 608,443,851) | CER 10.27 (無標點) @ Common Voice 16 yue test | Common Voice 16 zh-HK+yue、CantoMap、Cantonese-ASR (HKUST) | 已驗證：downloads 427,647（全批最高），config.json 確認 Wav2Vec2BertForCTC，AutoModelForCTC 直接 load。唯一非 Whisper 系強選擇，CTC 架構推理快、無 hallucination 風險，但輸出無標點。t |
| `alvanlii/distil-whisper-small-cantonese` | 157M (F32 156,682,752) | CER 9.7 (無標點) / 11.59 (有標點) @ CV16 yue test；GPU 0.027s/sample（比本尊快一倍） | 同 alvanlii/whisper-small-cantonese：Common Voice yue+zh-HK、CantoMap、Cantonese-ASR | 已驗證：config.json 確認 whisper 格式，downloads 得 128 但係本尊嘅官方 distil 版，README 有齊同本尊嘅對比表（CER 0.097 vs 0.089）。想鬥速度/細 model 一檔可以入擂台；如果擂台只鬥準，佢一定輸俾本尊，可視乎 |
| `JackyHoCL/whisper-large-v3-turbo-cantonese-yue-english` | 809M (F32 808,878,080) | 2025-07-21 版：CV17 yue test CER 0.64%、粵英混合 test 8.3%、en test 5.22%、zh-CN 11.89%（CV17 yue 0.64% 極可能有 train/test 重疊，宜自行重測） | Common Voice 17/16.1 + 自製 JackyHoCL/cleaned_mixed_cantonese_and_english_speech（粵英夾雜語料） | 已驗證：downloads 547、likes 12，config.json 確認 whisper 格式，2025-10 有更新。唯一專攻粵英 code-switching 嘅 large-v3-turbo fine-tune，香港實際場景（中英夾雜）好有用。注意 README  |
| `JackyHoCL/whisper-small-cantonese-yue-english` | 242M (F32 241,734,912) | 2025-07-23 版：CV17 yue test CER 1.188%（同樣可疑地低）、粵英混合 test 11.98%、en 7.58%、zh-CN 13.96% | Common Voice 17/16.1 + JackyHoCL/cleaned_mixed_cantonese_and_english_speech | 已驗證：downloads 78，config.json 確認 whisper 格式，2025-07-23（今日）啱啱更新。細粒（242M）粵英混合選擇，同 alvanlii whisper-small 同量級可以直接對打。CER 自報數同上一樣要打折扣，用獨立集重測先算數。 |
| `khleeloo/whisper-large-v3-cantonese` | 1.54B (F32 1,543,490,560) | CER 7.26 @ CV17 yue test、8.77 @ CV15 yue、18.88 @ CV15 zh-HK（作者解釋：冇 train 書面粵語 zh-HK）；base whisper-large-v3 對照 16 @ CV15 yue | Common Voice 17 yue（10 epochs, lr 1e-7） | 已驗證：downloads 515、likes 28、有 DOI，作者係 Cantonese-ASR 數據集論文作者之一（Rita Frieske）。注意 repo 係 gated: auto——匿名 curl config.json 食 401，要 HF 帳號同意條款攞 tok |
| `simonl0909/whisper-large-v2-cantonese` | 1.54B (F32 1,543,304,960) | CER 6.7274 @ CV11 yue test | Common Voice 11.0 yue（5000 steps） | 已驗證：downloads 235、likes 13，config.json 確認 whisper 格式。經典 large-v2 廣東話 fine-tune（2023 年，alvanlii README 都攞佢做 speculative decoding 嘅大 model 例子） |
| `Scrya/whisper-large-v2-cantonese` | ~1.54B (large-v2) | CER 6.21 on Common Voice 11 yue test (eval loss 0.1828) | mozilla-foundation/common_voice_11_0 yue (train+validation), audiomentations 增強 (PitchShift/TimeStre | 2022 whisper-event 年代嘅正牌 large-v2 廣東話 fine-tune，config 確認 WhisperForConditionalGeneration，model card 有齊 CER 數（6.21 CV11 yue）。淨係得 pytorch_mod |
| `cenzh3/whisper-small-cantonese-ckpt9693` | 242M (safetensors 241,734,91 | 冇報。repo 名 ckpt9693 疑似 96.93 分數但無法證實 | unknown——冇 README；repo 附 predict.py 自稱 'Offline competition entry point for the Cantonese Whisper mo | 2026-07-20 先更新嘅比賽用廣東話 whisper-small checkpoint，齊 config/tokenizer/safetensors，predict.py 證實直接用 transformers WhisperForConditionalGeneration  |
| `awong-dev/whisper-large-v3-cantonese` | ~1.54B (safetensors 1,543,49 | 冇具體數字——card 話 metric 係 CER 但只提供 tensorboard runs/ log，兼有 checkpoint-27000/33000 中途 checkpoint | mozilla-foundation/common_voice_17_0 yue | 2026-04 活躍嘅 large-v3 CV17 yue fine-tune，root 有齊 config + sharded safetensors，transformers 直接 load。冇公開 CER 數字，要自己跑 eval；同帳號另有 tristage/yue-lo |
| `6x16/whisper-large-v3-turbo-yue-continuous` | 809M (safetensors 808,878,08 | CER 9.60 on eval set (loss 0.2660)；訓練過程由 14.30 一路落到 9.60 | Common Voice 15.0 + 16.0 + 17.0 yue 合併，2000 steps 持續訓練 | 正規 v3-turbo 粵語持續訓練 fine-tune，三代 Common Voice 齊上，有完整 CER 曲線，transformers 直接 load。下載量低（5）但質素指標齊全，turbo 架構推理快，值得入擂台。 |
| `ctl/wav2vec2-large-xlsr-cantonese` | ~317M (XLSR-53 large，冇 safet | Test CER 15.36（card metadata）／15.51（README 實測段落），Common Voice zh-HK test | Common Voice zh-HK train+validation (xlsr-fine-tuning-week) | 最早期經典 XLSR 廣東話 ASR（2021 fine-tuning week），config 確認 Wav2Vec2ForCTC，README 有完整 eval script 同 CER。舊但係 CTC baseline 代表，入擂台做參照有價值。 |
| `scottykwok/wav2vec2-large-xlsr-cantonese` | ~317M (XLSR-53 large，冇 safet | CER 15.11 on Common Voice zh-HK test | Common Voice zh-HK 6.1.0，80 epochs（ctl 配方加倍 epochs） | 下載量最高（38k）嘅 XLSR 廣東話 fine-tune，係 ctl 模型嘅加強版（80 epochs），CER 15.11 略好過 ctl。Wav2Vec2ForCTC 直接 load，有 GitHub repo（cantonese-selfish-project）配套。 |
| `CAiRE/wav2vec2-large-xlsr-53-cantonese` | ~317M (XLSR-53 large，冇 safet | CER 18.55 on Common Voice zh-HK test | Common Voice Corpus 8.0 zh-HK validated train+dev | HKUST CAiRE 實驗室出品，有引用格式同訓練 script（holylovenia/wav2vec2-pretraining），Wav2Vec2ForCTC 直接 load。CER 18.55 係三隻 XLSR 入面最差，但學術出處清楚，做 CTC 對照組合理。 |
| `ivanlau/wav2vec2-large-xls-r-300m-cantonese` | ~300M (XLS-R 300m, pytorch_m | CV8 zh-HK test: CER 21.96 / WER 81.11（無 LM）；CER 21.58 / WER 80.56（有 5-gram LM）；Robust Speech Event dev CER 61.6，eval CER 61.55 | Common Voice 8.0 zh-HK | 已 curl 證實：config.json 係標準 Wav2Vec2ForCTC，輸出漢字，repo 內有齊 eval 紀錄同 5-gram LM。真・廣東話 fine-tune，transformers 直接 load 到，有正式 CER 數字可以入擂台。注意 CER ~22% |
| `w11wo/wav2vec2-xls-r-300m-zh-HK-lm-v2` | 319M (safetensors total 3191 | 無 LM：CV 31.73% / CV7 23.11% / CV8 23.02% CER；有 LM：CV 24.09% / CV7 23.10% / CV8 23.02% CER；Robust Speech Event dev ~56.9% | Common Voice zh-HK subset；5-gram LM 用 PyCantonese corpora 文本訓練 | 已 curl 證實：標準 Wav2Vec2ForCTC，safetensors 齊全，language_model/ 目錄有 5gram.bin 可以配 pyctcdecode 用。真・粵語 fine-tune 加粵語 LM decode，transformers 直接 load |
| `AlienKevin/whisper-small-jyutping-without-tones-all` | 244M (whisper-small, pytorch | eval WER 5.52（粵拼音節、無聲調嘅 WER，唔係漢字 CER） | Common Voice 14.0 yue + zh-HK + MDCC（card 自稱「almost all open source Cantonese datasets」） | 已 curl 證實：標準 WhisperForConditionalGeneration，transformers 直接 load，真・粵語 fine-tune，訓練數據覆蓋廣（CV14+MDCC）。大caveat：輸出係無聲調粵拼而唔係漢字，5.52 WER 係粵拼音節指標—— |
| `facebook/mms-1b-all` | 965M backbone (safetensors t | model card 冇逐語言數字——冇 yue-specific CER/WER，只有 MMS paper 嘅 aggregate 指標 | MMS 多語 fine-tune，1162 種語言（宗教文本為主嘅 MMS-lab 數據 + FLEURS 等）；yue 係其中之一 | 已 curl 證實：標準 Wav2Vec2ForCTC，官方 yue-script_traditional adapter 檔案實際存在，transformers >=4.30 原生支援 adapter 切換，285K downloads。真・官方支援粵語、直接 load 到，可 |
| `FunAudioLLM/Fun-ASR-Nano-2512-hf` | 830M（safetensors BF16 829,79 | 自身 README 冇數字，引用原版 card（AIShell1 1.80、行業 Dialect 28.18 等），冇粵語專項數字 | 同原版：數千萬小時真實語音，語言 tag zh/en/ja/yue | 官方 transformers 版：有 config.json + safetensors，architectures=FunAsrNanoForConditionalGeneration，README 有完整 AutoProcessor/AutoModelForSpeechSe |
| `wcyat/whisper-small-yue-mdcc-cantomap` | 244M（safetensors 實數 241,734, | 冇 README（404），冇報 CER/WER | MDCC + CantoMap（粵語會話語料）——repo 名推斷，冇 model card 寫明 | 唯一一個 transformers 直接 load 到嘅：有 config.json、safetensors、pipeline=ASR、library=transformers，whisper-small 粵語 fine-tune，可以直接入擂台鬥準。注意 wcyat 帳號有 3 |
| `safecantonese/whisper-small-yue-mdcc` | 242M (safetensors F32: 241,7 | 冇 model card（README.md 404），冇任何 CER/WER 數字 | MDCC（Multi-Domain Cantonese Corpus，按 repo 名同 SafeCantonese 出處推斷；repo 冇 README 落實） | 落實存在：config.json 有 WhisperForConditionalGeneration，safetensors 242M，齊 tokenizer/preprocessor 檔，transformers 直接 load 到。真粵語 fine-tune（SafeCant |
| `Oblivion208/whisper-small-cantonese` | 244M（README 自報） | model card：MDCC test CER 6.16%；CV11 CER 31.23%（未 joint finetune）；同系 whisper-large-v2-lora-cantonese MDCC CER 3.77% | MDCC + Common Voice 11.0 (yue)；同系列有 tiny/base/small-LoRA/large-v2-LoRA 變體 | 落實存在，yue tag + CV11 dataset tag，card 有齊成個系列嘅 CER 對照表，transformers 直接 load。真粵語 whisper fine-tune 有自報數字，正宗擂台選手。 |
| `reachan/Cantonese-Whisper-Medium` | 764M (safetensors F32: 763,8 | 自家 eval set：CER 6.28% / WER 39.4%（對比 base openai/whisper-medium CER 38.5%） | 100.5 小時粵語：tomsawyerhu/cantonese-dialect (17.8h) + ModelScope commonvoice_cantonese (9.1h) + 香港粵語音頻數 | 落實存在，card 有訓練數據明細、CER 數字同 transformers 示範代碼（WhisperForConditionalGeneration 直接 load）。真粵語 medium 級 fine-tune，本批 whisper 系入面數據最齊嘅一個。注意 languag |
| `thisiskeithkwan/whisper-medium-cantonese` | ~769M（whisper-medium 標準大小；py | 冇 model card（README.md 404），冇任何 CER/WER 數字 | 未知（冇 README；有 training_args.bin/tensorboard runs 證明係真 fine-tune；同帳號有 cantomed 醫療粵語系列） | 落實存在：config 係 WhisperForConditionalGeneration，齊 tokenizer 檔，transformers 直接 load。repo 名 + 帳號背景（cantomed 醫療粵語）指向真粵語 fine-tune，但零文檔——收入擂台實測，數據 |
| `Qwen/Qwen3-ASR-1.7B` | 1.7B（LM 部分；safetensors 總重 2. | 官方 card (WER↓)：Fleurs-yue 3.98、CV-yue 7.57、WenetSpeech-Yue short 5.82 / long 8.85、內部 Dialog-Cantonese 4.12——全部粵語 benchmark 贏晒對照組 | 大規模多語語音（30 語言 + 22 中國方言，明確含 Cantonese HK accent / Guangdong accent；細節冇公開） | 落實存在，1.6M downloads，粵語支援寫死喺 config.json support_languages，card 有齊 yue benchmark。注意：呢個 repo 本身係 qwen-asr package / vLLM 格式（library_name=None， |
| `Qwen/Qwen3-ASR-0.6B` | 0.6B（LM 部分；safetensors 總重 93 | 官方 card (WER↓)：Fleurs-yue 5.79、CV-yue 9.50、WenetSpeech-Yue 7.54/9.92、Dialog-Cantonese 4.80 | 同 1.7B：大規模多語語音，30 語言 + 22 方言，含粵語 HK/廣東口音 | 落實存在，1.27M downloads，config 寫明支援 Cantonese，card 有 yue 數字。同 1.7B 一樣：本 repo 係 qwen-asr/vLLM 格式，transformers 直接 load 要用官方孖生 repo Qwen/Qwen3-ASR |
| `AutoArk-AI/Audio8-ASR-0.1B` | 0.324B end-to-end（LM 部分 0.10 | Open ASR Leaderboard EN 七項 mean WER 7.03；WenetSpeech ZH CER 7.98–8.84。粵語冇任何 eval 數字 | 由 Qwen3-ASR 0.6B teacher 蒸餾；語言列表明確有 yue（en/zh/fr/ja/yue/de/ko） | 明確支援 yue 嘅超細多語 ASR，safetensors + transformers 載入（要 trust_remote_code=True）。README 有 EN/ZH 數但粵語準確度零數據，入擂台正好實測——0.3B 咁細如果粵語都掂就好抵。註：CC-BY-NC-4. |
| `MERaLiON/MERaLiON-3-3B-ASR` | 3.3B (safetensors BF16 3,307 | Cantonese section mean WER/CER 11.27（前代 18.55，Δ−7.3pp）；cv21_cantonese_test 13.88（對比 Qwen3-ASR 25.08、gpt-4o 8.74） | 新加坡／東南亞為中心嘅 ASR 數據，特調 code-switching；粵語係官方 coverage（Chinese dialects: Cantonese, Hokkien），repo 附 Can | 真・官方粵語支援嘅開源 ASR，transformers 載入（trust_remote_code），仲有齊粵語 benchmark 數（cv21_cantonese_test 13.88、mean 11.27），完全夠資格入擂台鬥準。3.3B 單卡跑到。License 係自家  |
| `facebook/seamless-m4t-v2-large` | ~2.3B | model card 冇 yue-specific CER/WER（metrics 只列 bleu/wer/chrf 通用指標） | Meta 大規模多語多模態數據（SeamlessAlign 等）；語言表確認 yue：Source=Speech+Text, Target=Text，即粵語 ASR 官方支援 | transformers 原生載入（唔使 remote code），官方語言表確認 yue speech→text，係正經可入擂台嘅 baseline。註：本業係翻譯／S2ST，粵語 ASR 準確度未必贏專門 fine-tune，而且輸出係繁體書面化傾向；CC-BY-NC-4.0 |
| `voidful/whisper-small-zh-hk` | ~244M（whisper-small 標準；pytor | 無：README 唔存在（Entry not found），冇任何 CER/WER 數字 | unknown（repo 名指 zh-HK 即 Common Voice zh-HK 之類，但冇 card 證實；有 trainer_state/optimizer 殘留證明真係 fine-tune  | 真・zh-HK（廣東話）whisper-small fine-tune，config.json 確認 WhisperForConditionalGeneration，transformers 直接 load 到，pipeline_tag=ASR。2022 年舊 checkpoin |
| `WayneLinn/Whisper-Cantonese` | ~244M（whisper-small 標準；pytor | eval_wer 60.0485（eval_loss 0.3030）— 注意係 step 1000/4000 中途 checkpoint 嘅數，且係 WER 唔係 CER，中文字逐字當詞計會谷大 | Common Voice 11.0（language tag yue），lr 1e-5、batch 16、4000 steps | 真・粵語 whisper-small fine-tune（tag yue、CV11），config.json 確認 WhisperForConditionalGeneration，transformers 直接 load。2022 早期作品，card 得中途 eval 數（WER |
| `jed351/whisper_small_cantonese_cm_voice` | 244M (pytorch_model.bin, con | WER 0.5615（中文無空格情況下 WER 數字接近字級錯誤，模型卡冇另報 CER） | mozilla-foundation/common_voice_11_0 zh-HK, 5000 steps | 真・粵語 whisper-small fine-tune（CV11 zh-HK），transformers 直接 load 到，有完整 eval 記錄。2023 年舊作，downloads 低但 repo 健全。 |
| `baikai1022/whisper-small-cantonese-v2` | 242M (safetensors F32 241,73 | 冇報任何 CER/WER 數字 | unknown dataset（模型卡自動生成，冇講明數據；5 epochs） | 2026-01 新鮮 whisper-small 粵語 fine-tune，safetensors 齊全、transformers 直接 load。但訓練數據同 eval 數字全無——入擂台可以，預期文檔零分，粵語成份靠名同 forced_decoder_ids 推斷。 |
| `awong-dev/wav2vec2-xls-r-1b-cantonese` | 967M (safetensors F32 966,50 | CER 20.57%（去標點）/ 20.85%（raw），CV17 yue test set | mozilla-foundation/common_voice_17_0 config=yue，~13 epochs / 76k steps，有完整 training history | 2026-04 新作，XLS-R 1B 大底粵語 CTC fine-tune，tags 齊（yue/cantonese），model.safetensors + config 標準 transformers 格式直接 load，仲有最詳細嘅 eval 曲線。雖然 library_ |
| `jed351/whisper_medium_cantonese_cm_voice` | 769M (whisper-medium) | WER 0.4573（模型卡內部名叫 whisper-large-v2-zh-hk-2gpu 但 config 實際係 medium） | mozilla-foundation/common_voice_11_0 zh-HK, 5000 steps | jed351 同系列 medium 版，CV11 zh-HK fine-tune，WER 0.4573 好過佢 small 版（0.5615），transformers 直接 load。注意 model-index 名寫 large-v2 係筆誤，config.json 證實係  |
| `Oblivion208/whisper-tiny-cantonese` | 39M | CER 11.10%（MDCC test）；CV11：原版 124.03% → fine-tune 後 35.87% | MDCC + mozilla-foundation/common_voice_11_0 (yue)，LoRA/full fine-tune 系列一員（GitHub: fengredrum/finetu | 文檔最好嘅一個：有 usage code、MDCC+CV11 CER 對照表，transformers 直接 load，39M 啱輕量部署。同系列仲有 base(7.66%)/small(6.16%)/large-v2-lora(3.77% MDCC) 版，個表本身係成個系列嘅  |

## ② 留意組（要特殊 runtime，入唔到 transformers 擂台）

| repo | 點解入唔到／點解仲要留意 |
|---|---|
| `JackyHoCL/whisper-large-v3-turbo-cantonese-noise-detection` | 已驗證：downloads 28、likes 4，config.json 確認 whisper 格式。真・廣東話 ASR 且 transformers load 得，但定位係 streaming 抗噪特化版——輸出帶 %nz 噪音標記要後處理先計到 CER，且係同系 yue-english model 嘅衍生版（擂台已有本尊）。做乾淨音頻擂台意義唔大，做 streaming/嘈雜場景先攞佢出嚟。 |
| `wcfr/wav2vec2-conformer-rel-pos-base-cantonese` | 已 curl 證實：architectures 係 ForPreTraining，冇 CTC head，唔能夠直接做 ASR 輸出文字，所以入唔到擂台。但 2.8K 小時粵語語音 pretrain 底模（Huang & Mak, Interspeech 2023）係罕見資產，攞嚟 fine-tune 落粵語 label 數據可能好過 XLS-R。 |
| `hon9kon9ize/wav2vec2bert-jyutping` | 已 curl 證實：真・粵語 ASR 而且係香港社群 hon9kon9ize 出品、2025-11 仲有更新、downloads 全批最高（293）。但 architectures 係自定義 Wav2Vec2BertForCantonese，config 冇 auto_map，標準 transformers AutoModel load 唔到——要跟 README clone GitHub repo 用佢個 model.py。加上輸出係 |
| `FunAudioLLM/SenseVoiceSmall` | 真・支援粵語嘅熱門 ASR（26469 downloads / 435 likes），但只有 model.pt + config.yaml，冇 config.json 冇 safetensors，要 funasr runtime 先行到，唔係 transformers 直接 load。粵語 ASR 必比較對象，但入唔到 transformers 擂台 |
| `FunAudioLLM/Fun-ASR-Nano-2512` | 官方 yue tag、粵語係支援方言之一，benchmark 數字齊全，但 library=funasr，只有 model.pt + config.yaml，要 funasr runtime。想入擂台請用佢嘅 -hf 版 |
| `FunAudioLLM/Fun-ASR-MLT-Nano-2512` | 官方 31 語版明確支援粵語、2512 新出，但 funasr runtime（冇 config.json/safetensors），而且連自己 checkpoint 嘅 benchmark 都未出。留意佢遲啲會唔會出 -hf 版同逐語言數字 |
| `csukuangfj/sherpa-onnx-paraformer-trilingual-zh-cantonese-en` | 真・含粵語嘅三語 Paraformer，但係 ModelScope 模型嘅 sherpa-onnx 轉換版，要 sherpa-onnx runtime，冇 transformers 格式、冇 benchmark、HF downloads=1。想比較準確度應該去搵 ModelScope 原版；sherpa 部署場景先有用 |
| `csukuangfj/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en` | 真三語（普/粵/英）串流 Paraformer，但係 sherpa-onnx 專用 ONNX 格式（冇 config.json，404），transformers load 唔到，要 sherpa-onnx runtime 先用得。適合實時轉寫場景留意，唔入 transformers 擂台。downloads=7。 |
| `Diogodiogod/FunASR-Paraformer-Cantonese` | 呢個係 dengcunqin 三語 Paraformer 喺 HF 上最完整嘅原格式鏡像（有 model.pt），downloads=123 係三個鏡像入面最多。但冇 config.json（404），要 FunASR runtime，唔係 transformers 直 load，所以係 watch 唔係 contender。注意 WSYue-ASR leaderboard 顯示 Paraformer 喺粵語 benchmark CER |
| `csukuangfj/sherpa-onnx-wenetspeech-yue-u2pp-conformer-ctc-zh-en-cantonese-2025-09-10` | 源模型係 2025 年 WenetSpeech-Yue 出品，粵語 CER 數字好強（MDCC 5.73），係認真嘅 SOTA 級粵語 ASR。但呢個 repo 係 sherpa-onnx ONNX 轉換版（冇 config.json，downloads=0），要 sherpa-onnx runtime。想入擂台應該直接睇源 repo ASLP-lab/WSYue-ASR（入面仲有 SenseVoice-small-Yue 同 Whis |
| `zrjin/icefall-asr-mdcc-zipformer-2024-03-11` | 真粵語 zipformer，MDCC test CER 7.22 有紀錄支持（我直接 curl 咗 wer-summary 檔）。但係 icefall/k2 格式，冇 config.json，要 k2/sherpa runtime 先跑到，transformers load 唔到。downloads=0 但質素認真。 |
| `zrjin/icefall-asr-commonvoice-zh-HK-zipformer-2024-03-20` | 真粵語 zipformer，CV test 1.27 睇落勁但 Common Voice 句子重覆度高，MDCC 出域測試爆到 37.74，明顯 overfit CV。icefall/k2 格式唔係 transformers。留意但唔好被 1.27 誤導。 |
| `siuze/Cantonese-MDCC` | 2023 年 ESPnet 格式 MDCC 模型，要 ESPnet runtime（仲要 checkout 指定 commit），冇 config.json。RESULTS 表全 100% 錯誤率係壞數據，實際質素未知。downloads=4。相關但入唔到擂台，質素成疑，優先度低過兩個 zrjin zipformer。 |
| `XINGWEILIN/federated-learning-whisper-tiny-Cantonese` | 落實存在但 repo 只有 config.json + generation_config + model.safetensors——冇 tokenizer/preprocessor 檔，pipeline_tag 都冇，直接 from_pretrained 做唔到完整 pipeline（要另外借 openai/whisper-tiny 嘅 processor）。whisper-tiny 級 FL 實驗、0 downloads、零文檔，唔 |
| `XiaomiMiMo/MiMo-V2.5-ASR` | 真・多語 ASR 有官方 yue 支援（tags + README「Native support for...Cantonese」），但唔係 transformers 直接 load 到：MiMoV2ASRForCausalLM 冇 auto_map、冇 remote code，要 clone 佢哋 GitHub repo + flash-attn + CUDA + 獨立 audio tokenizer 先跑到。~7.6B 都幾重。有跑 |
| `espnet/xeus` | 唔係轉寫模型，係 4000+ 語言 SSL encoder backbone，要 espnet runtime 再自己駁 CTC/attention head fine-tune 先做到粵語 ASR。150 likes 有江湖地位，做粵語 ASR 研究底座值得留意，但唔可以直接入擂台。CC-BY-NC-SA-4.0 非商用 license 都要注意。 |
| `neurlang/ipa-whisper-medium` | transformers load 到、tag 有 yue，但輸出係 IPA 音標唔係中文字，冇得同人鬥漢字 CER。訓練 label 係合成 IPA、粵語佔 75k wav 入面好少份。凈係做音標層面粵語轉寫（例如發音研究）先啱用。 |
| `Yvthyvq/Liujgoj-Cantonese-Qwen3.5-9b-ASR-lora` | 驗證結果：唔係語音輸入 ASR。task_type=CAUSAL_LM、base 係 qwen3_5_text 純文字模型，prompt 示例輸入係 Liujgoj 羅馬拼音文字（『Tengj neij dvnh yvqyamj...』），佢做嘅係拼音→正字嘅文字轉換，冇 audio encoder。要靠未知嘅上游聲學模型出拼音先用到，仲要 vLLM 載 9B。粵語專屬 pipeline 部件、概念得意，留意但入唔到 ASR 擂台。 |
| `thisiskeithkwan/int8-whisper-large-v2-cantomed` | LoRA adapter-only repo：要 PEFT + openai/whisper-large-v2（int8）先跑到，唔可以直接 WhisperForConditionalGeneration.from_pretrained 入擂台。醫療粵語方向獨特值得留意，但零文檔零 downloads，質素無從證實。 |

## ③ 跳過組（轉換版重覆／壞 repo／玩具）

| repo | 原因 |
|---|---|
| `wingskh/whisper-large-v3-turbo-cantonese` | 玩具級：training log 顯示只 train 咗 10 步、WER 90.9%，係測試 pipeline 嘅產物而唔係可用模型。技術上 transformers load 到，但入擂台冇意義。 |
| `johnyy212/wav2vec2_cantonese_jyut-20hr` | 已 curl 證實：雖然格式係標準 Wav2Vec2ForCTC 兼 load 得到，但 model card 自己report eval WER=100%——即係每個詞都錯，訓練基本上失敗（只行 5 epochs，loss 仲喺 2.4）。屬玩具／失敗實驗，冇實用價值，唔使入擂台。 |
| `Marco-Cheung/wav2vec2-large-mms-1b-cantonese` | 已 curl 證實壞 repo：API 顯示 siblings 只有 tokenizer 檔案，config.json resolve 返「Entry not found」，README 都冇。上載未完成或者已刪 weights，完全 load 唔到，跳過。 |
| `handy-computer/SenseVoiceSmall-gguf` | SenseVoiceSmall 嘅 GGUF 量化轉換版（base=FunAudioLLM/SenseVoiceSmall），要 transcribe.cpp runtime。文檔認真、有量化 WER 驗證，本地部署好用，但擂台計 base 就得，轉檔重覆 |
| `cstr/sensevoice-small-GGUF` | 另一個 SenseVoiceSmall GGUF 轉換版（base=FunAudioLLM/SenseVoiceSmall），俾 CrispASR 用，同 handy-computer 版重覆，冇 benchmark |
| `ruska1117/SenseVoiceSmall-onnx` | SenseVoiceSmall 嘅非量化 ONNX 轉檔（base=iic/SenseVoiceSmall），8 downloads，純格式轉換冇加值，重覆 |
| `packetingz/speech_paraformer-large_asr_nat-zh-cantonese-en-16k-vocab8501-online` | 同一個 dengcunqin ModelScope base 嘅第三個 HF 鏡像（量化 ONNX），同 csukuangfj sherpa-onnx 版同 Diogodiogod FunASR 版重覆，downloads=2，冇獨特價值。base = dengcunqin trilingual Paraformer  |
| `handy-computer/Qwen3-ASR-1.7B-gguf` | 落實存在且做得認真（137K downloads、逐級量化 WER 驗證），但係 Qwen/Qwen3-ASR-1.7B 嘅 GGUF 轉換版，要 transcribe.cpp 專用 runtime，transformers load 唔到——按規則屬轉換版重覆，base 已經以 -hf 版入擂台。本地離線跑粵語想慳資 |
| `Daumee/Qwen3-ASR-0.6B-ONNX-CPU` | 純轉換版：Qwen/Qwen3-ASR-0.6B 嘅 ONNX int8 CPU 轉檔（base = Qwen/Qwen3-ASR-0.6B）。要用自帶 onnx_inference.py + onnxruntime 跑，唔係 transformers 格式。粵語能力全部嚟自 base，入擂台應該用 base 本尊。 |
| `Systran/faster-whisper-large-v3` | 純 CT2 轉換版（base = openai/whisper-large-v3），粵語能力同 base 一樣。擂台應該直接用 openai/whisper-large-v3（transformers 原生）；呢個係 faster-whisper runtime 用嘅 deployment 格式，唔係新 model。 |
| `deepdml/faster-whisper-large-v3-turbo-ct2` | 純 CT2 轉換版（base = openai/whisper-large-v3-turbo）。同上，鬥準應該用 base 本尊；呢個只係 faster-whisper 部署格式。 |
| `XA9/faster-whisper-large-v2-cantonese-2` | 純 CT2 轉換版（base = Scrya/whisper-large-v2-cantonese）。轉檔本身唔入擂台，但 base Scrya/whisper-large-v2-cantonese 係真・廣東話 fine-tune，如果擂台未有應該另行驗佢本尊。 |
| `JackyHoCL/whisper-large-v3-turbo-cantonese-yue-english-ct2` | CT2/faster-whisper conversion duplicate of base JackyHoCL/whisper-large-v3-turbo-cantonese-yue-english — the base itself should be the arena entry; this repo ca |
| `ylpeter/faster-whisper-large-v3-turbo-cantonese-16` | Anonymous CT2 conversion with zero documentation (no README, no tags, downloads=11); duplicate format of the Cantonese turbo fine-tune family, not transformers- |
| `onnx-community/whisper-small-cantonese-ONNX` | Automated ONNX conversion duplicate of alvanlii/whisper-small-cantonese — base is the real contender. Useful only if a browser/transformers.js runtime is wanted |
| `gavinfukaml/whisper-large-v3-turbo-cantonese-yue-english-ONNX` | Automated ONNX conversion duplicate of JackyHoCL/whisper-large-v3-turbo-cantonese-yue-english (downloads=1). Base model is the arena entry; this adds only a tra |
| `doggy8088/whisper-large-v2-cantonese-mlx` | MLX (Apple Silicon) conversion duplicate of Scrya/whisper-large-v2-cantonese — base is the contender. Well-documented conversion (recommends --language zh since |
| `Huan69/whisper-large-v3-turbo-cantonese-yue-english-mlx` | MLX quantized conversion duplicate of JackyHoCL/whisper-large-v3-turbo-cantonese-yue-english; mlx-whisper runtime only, no docs beyond the conversion command. d |
| `kiuckhuang/whisper-large-v3-cantonese-ggml` | GGML/whisper.cpp quantization of khleeloo/whisper-large-v3-cantonese — base is the arena entry. whisper.cpp runtime only; downloads=0. Points to author's yt-tra |
| `betteropts/whisper-small-cantonese-ggml-q5_1` | GGML q5_1 quantization duplicate of alvanlii/whisper-small-cantonese for offline mobile (Vocal2Script app); whisper.cpp runtime only, downloads=0, explicitly st |
| `hyperkit/distil-whisper-small-cantonese-coreml` | 純 CoreML 轉換版，README 直認「This is a CoreML conversion of alvanlii/distil-whisper-small-cantonese」。冇 config.json、冇 safetensors，只有 .mlmodelc，得 whisperkit/iOS 用到。擂台應該 |
| `im-sciling/faster-whisper-large-v3-cantonese` | 空殼 repo：siblings 只有 .gitattributes 同 README.md，冇 model.bin、冇 config、冇任何 CT2 檔案。downloads=0。上載咗個名就冇下文，壞/未完成 repo。 |
| `suanan/vad-asr-zh_en_ja_ko_cantonese` | 唔係模型 repo，係 sherpa-onnx 官方 WASM demo 嘅重新上載（瀏覽器內 VAD+ASR 網頁）。冇獨立可 load 嘅模型檔，downloads=0。想要背後嘅粵語能力應該直接攞 SenseVoiceSmall / sherpa-onnx 官方發佈。 |
| `FunPang/whisper-small-Cantonese-fine-tune` | 玩具級 fine-tune：全訓練集推算得 ~64 條 audio、200 steps、WER 100。技術上 load 到但無比賽價值。FunPang 系列其他變體（large-v3、聖經朗讀數據）或者有料，值得另行逐個驗，但呢個代表 repo 本身係 toy。 |
| `btsehk/faster-whisper-small-cantonese` | CT2/faster-whisper 轉檔，唔係 transformers 格式，入唔到擂台；README 空白連 base 都冇標（同帳號另有 faster-whisper-medium-cantonese，一樣冇文檔）。如果將來查到 base 係邊個粵語 fine-tune，直接用返個 base 就得。 |

## ④ 評測數據集＋Leaderboard（砌自家 benchmark 用）

| repo | 係乜 |
|---|---|
| `mozilla-foundation/common_voice_17_0` | Common Voice 17 有 yue subset，粵語 ASR 訓練/評測最常用公開集 |
| `google/fleurs` | FLEURS 有 yue_hant_hk config，標準多語 ASR 評測集 |
| `ming030890/mdcc` | MDCC（Multi-Domain Cantonese Corpus，約 73.6 小時香港有聲書）HF 鏡像，粵語 ASR 標準評測 |
| `ming030890/cantonese_asr_eval_mdcc_long` | MDCC 長音頻評測集，測長錄音場景 |
| `CAiRE/ASCEND` | HKUST 中英 code-switching 自然對話語料（香港錄製），評測混講必備 |
| `georgechang8/ASCEND_CLEAN` | ASCEND 清洗版，標註較乾淨 |
| `safecantonese/cantomap` | CantoMap 粵語會話語料 HF 版 |
| `alvanlii/cantonese-youtube` | 大規模粵語 YouTube 音頻（偽標註），alvanlii 系列模型嘅訓練來源 |
| `alvanlii/cantonese-radio` | 粵語電台音頻數據集 |
| `AlienKevin/sbs_cantonese` | SBS 粵語 podcast 半監督語料 |
| `AlienKevin/wordshk_cantonese_speech` | words.hk 例句朗讀語音 |
| `AlienKevin/mixed_cantonese_and_english_speech` | 粵英混講語音，啱測 code-switching |
| `hon9kon9ize/yue_emo_speech` | 粵語情感語音集（帶轉寫，可作輔助評測） |
| `Multilingual-NLP/YUE-PUB-Speech` | 2026 年新出嘅粵語公開語音集，下載量升緊 |
| `kxwhi/yue_speech_benchmark_fixed` | 粵語語音 benchmark（修正版） |
| `JackyHoCL/common_voice_22_yue` | Common Voice 22 yue 整理版（另有加背景聲 caption 版） |
| `ming030890/common_voice_21_0_yue` | Common Voice 21 yue 抽取版 |
| `hon9kon9ize/common_voice_17_yue_jyutping` | CV17 yue 加粵拼標註版 |
| `kaschung4/common_voice_17_yue_pseudo_labelled` | CV17 yue pseudo-labelled 擴充版 |
| `ziyou-li/cantonese_daily` | 日常粵語對話語音（MagicHub 系） |
| `ziyou-li/cantonese_processed_guangzhou` | 廣州腔粵語語音，測口音泛化 |
| `laubonghaudoi/cantonese-srt` | HF Space：粵語字幕/SRT 生成 demo，活躍維護 |
| `simonl0909/whisper-cantonese-demo` | HF Space：whisper large-v2 粵語 demo |
| `echoyzd/web-assembly-asr-sherpa-onnx-zh-cantonese-en-paraformer` | HF Space：WASM 瀏覽器內串流 Paraformer 三語（普/粵/英）demo |
| `hf-audio/open_asr_leaderboard` | HF Space：Open ASR Leaderboard — 通用 ASR 排行榜，暫時冇粵語 track，作方法論參考 |
| `ASLP-lab/WenetSpeech-Yue` | WenetSpeech-Yue 大規模粵語 ASR 語料原版 |
| `DataoceanAI/Dolphin_Model_Cantonese-Speech-Recognition-Corpus` | DataoceanAI 粵語 ASR 商業語料樣本 |
| `DataoceanAI/Dolphin_Model_Hong-Kong-Cantonese-Speech-Recognition-Corpus` | DataoceanAI 香港粵語 ASR 語料樣本 |
| `OrcinusOrca/YouTube-Cantonese` | YouTube 粵語語音數據 |
| `shunyalabs/cantonese-speech-dataset` | 粵語語音數據集 |
| `JackyHoCL/cleaned_mixed_cantonese_and_english_speech` | 清洗過嘅粵英混合語音數據 |
| `alvanlii/cantonese-youtube-transcription` | 粵語 YouTube 轉寫數據 |
| `viictte/Elderly-Cantonese` | 長者粵語語音數據（老人語音 ASR 難點） |
| `psdn-ai/cantonese-speech-samples` | 粵語語音樣本 |
| `NiuChou/pazhou-cantonese-asr-16k` | 琶洲粵語 ASR 16k 語料 |
| `quyanh/cv-cantonese` | Common Voice 粵語整理版 |
| `poppysmickarlili/common_voice_yue` | Common Voice yue 整理版（作者有多個粵語 whisper） |
| `CAiRE/YueMotion` | 粵語語音情緒數據（語音相關，非純 ASR） |
| `HKAllen/cantonese-chinese-parallel-audio` | 粵語-中文平行音頻數據 |
| `alex-tecky/common_voice_zh_hk_processed` | Common Voice zh-HK 處理版 |
| `CWKSC/common_voice_13_0-zh-HK-whisper-small` | CV13 zh-HK 配 whisper-small 處理數據 |
| `N03N9/cv24-zh-hk-128-normalized` | CV24 zh-HK normalize 版 |
| `J-sy/mdcc` | MDCC 粵語語料 mirror |
| `johnyy212/cv-corpus-24-yue-jyutping` | CV24 yue 粵拼標註版 |
| `johnyy212/cv-corpus-24-yue-jyutping-20hr` | CV24 yue 粵拼 20 小時子集 |
| `johnyy212/cv-corpus-24-yue-jyutping-20hr-revised` | CV24 yue 粵拼 20 小時修訂版 |
| `johnyy212/cv-corpus-24-yue-validated_20h` | CV24 yue validated 20 小時子集 |
| `AlienKevin/guangzhou-daily-use-speech` | 廣州日常用語語音（MagicData 來源） |
| `AlienKevin/guangzhou-cabin-speech` | 廣州車廂場景語音 |
| `AlienKevin/cantone` | 粵語音節發音音頻集 |
| `thisiskeithkwan/canto_full` | 作者訓練粵語 whisper 用嘅語料 |
| `thisiskeithkwan/canto_full_7` | 作者訓練粵語 whisper 用嘅語料（v7） |
| `kakiso/KarenSo_CantoneseRecordings` | KarenSo 粵語錄音集 |
| `Yvthyvq/KarenSo_CantoneseRecordings_Liujgoj` | KarenSo 粵語錄音（流嘢粵拼版） |
| `alvanlii/canto-asr-test` | alvanlii 粵語 ASR 測試集 |
| `alvanlii/cantonese-youtube-tts` | 粵語 YouTube 音頻+文本（tag 同時有 ASR/TTS，可訓 ASR） |
| `hon9kon9ize/yue_asr_eval_dataset` | 粵語 ASR 評測集 |
| `hon9kon9ize/zoengjyutgaai_saamgwokjinji_jyutping` | 張悦楷《三國演義》講古音頻+粵拼標註 |
| `hon9kon9ize/zoengjyutgaai_saamgwokjinji_jyutping_crossValidated` | 上面數據嘅交叉驗證版 |
| `JackyHoCL/Cantonese_Dataset` | 粵語音頻+文本數據（作者有成套粵語 whisper） |
| `JackyHoCL/common_voice_22_yue_w_background_caption` | CV22 yue 加背景聲 caption 版 |
| `JackyHoCL/cv22_yue_caption` | CV22 yue caption 版 |
| `modelevaluation/WenetSpeech-Yue` | WenetSpeech-Yue mirror |
| `yaweiyuan/WenetSpeech-Yue` | WenetSpeech-Yue mirror |
| `ming030890/youtube_caption_yue` | 粵語 YouTube 字幕音頻對數據 |
| `csathomaskywong/hong_kong_places_yue_en` | 香港地名粵英語音數據 |
| `csathomaskywong/hong_kong_places_yue_en_8khz` | 香港地名語音 8kHz 版（電話音質） |
| `edmundchan70/Cantonese_fine_tune` | 粵語 whisper finetune 用音頻+文本 |
| `kennychan-6/Cantonese_Dataset` | 粵語 audiofolder 數據 |
| `leeduckgo/cantonese-life-scenarios-corpus` | 粵語生活場景語音語料 |
| `noncegeek/cantonese-drama-voice-fine-grained` | 粵語廣播劇聲音細粒度標註 |
| `Yvthyvq/CantoMap-Liujgoj` | CantoMap 流嘢粵拼版（ASR+TTS tag） |
| `ziyou-li/cantonese_processed` | 粵語處理後語音數據（作者有 cantonese_daily 系列） |
| `ziyou-li/cantonese_processed_daily` | 粵語日常語音處理版 |
| `NCEPU-CHEN/cantone` | 粵語音節發音音頻（似 AlienKevin/cantone mirror） |
| `Laxus03/Alien` | tag 係粵語音節發音音頻（名唔明顯，疑似 cantone mirror，存疑照收） |
| `J017athan/Multimodal-Yue-Benchmark` | 粵語多模態語音 benchmark（含音頻） |
| `J-sy/aishell_yue_sc_data` | 名似粵語 AISHELL 數據，metadata 空白（存疑照收） |
| `J-sy/aishell_yue_sc_list` | 上面數據嘅清單檔（存疑照收） |
| `Jame-Leung/Sensevoice-Yue-HKCantonese` | SenseVoice 粵語 finetune 相關 repo，內容未細睇（存疑照收） |
| `MagicDataTech/magicdata-dialect-cantonese-tts-lite` | MagicData 粵語語音樣本（名係 TTS 但係音頻+文本，可作 ASR 素材） |
| `MagicHub/magicdata-dialect-cantonese-tts-lite` | 同上 MagicHub 帳號版 |
| `mesolitica/Cantonese-Radio-Description-Instructions` | 粵語電台音頻描述指令數據（audio-LLM 向，ASR 相鄰） |
| `boniromou/zh-yue-tts-dataset` | 粵語音頻+文本（TTS 名但可訓 ASR） |
| `boniromou/zh-yue-tts-dataset-100` | 上面數據 100 條子集 |
| `boniromou/38k-zh-yue-vocie-llm-datasets` | 名指 38k 粵語 voice LLM 數據，metadata 空白（存疑照收） |
| `indiejoseph/canto-songs` | 粵語歌音頻+文本（唱歌 ASR 用途有限，存疑照收） |
| `Akatsuki-Amemiya/Akatsuki_Cantonese_Singing` | 粵語歌聲數據（主要 SVS 用，ASR 用途有限） |
| `nizzzo/wn-yue` | 百萬級 audio+text webdataset，名似 WenetSpeech-Yue 打包（存疑照收） |
| `zengzhuo/yue` | audiofolder 名叫 yue，內容未知（存疑照收） |
| `Zhutingho/ZH-HK` | 名直指 zh-HK，冇 metadata（存疑照收） |
| `Ching-Yee-Chan/Cantonese-TTS` | 粵語 TTS 名數據，冇 metadata，或含音頻文本對（存疑照收） |

## 點揀（同「鬥準」策略嘅關係）

- **即刻可打**：`compare_models.py --models all` 跑擂台預設（turbo／large-v3／alvanlii small／
  JackyHoCL 粵英 turbo／simonl0909 v2／w2v-BERT），`--models full` 跑晒 19 個。
- **天花板參照**：Qwen3-ASR（Fleurs-yue WER 3.98 自報）同 sherpa-onnx WenetSpeech-Yue conformer
  （MDCC CER 5.73）係而家紙面最強嘅粵語開源——但都要自己 runtime，未入 transformers 擂台；
  將來想追極致可以逐個接。
- **fine-tune 起步點**：alvanlii 個 recipe（CV yue＋MDCC＋CantoMap＋YouTube pseudo-label）係
  最好嘅公開參考；④ 嘅數據集就係你將來自家 model 嘅原料庫。

# make-testdata.ps1 — 生成 T2.11 导入验证用最小 data.zip（真实 ST 结构）
# 产物：pc-verify-home/testdata/data.zip（characters 子目录卡 + 世界书 key 单数 + chats）
# 配套：node pc-verify-home/testdata/serve.cjs（4311 端口，CORS *）
$ErrorActionPreference = 'Continue'
$base = "D:\DSH RolePlay\rp-workspace\pc-verify-home\testdata"
$data = "$base\data"
Remove-Item $base -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$data\worlds", "$data\characters\测试角色", "$data\chats\测试角色" | Out-Null

$worldJson = '{"name":"测试书","entries":[{"uid":1,"key":"咖啡厅","content":"安静的路边咖啡厅，桌上摊着一本翻开的书。","comment":"咖啡厅","constant":false,"position":0,"depth":4,"selective":false,"exclude_recursion":false,"prevent_recursion":false,"disable":false,"probability":100}]}'
$cardJson = '{"spec":"chara_card_v2","spec_version":"2.0","data":{"name":"测试角色","description":"一位在咖啡厅看书的少女。","personality":"认真","scenario":"水族馆","first_mes":"风铃作响，她从书页间抬起头：「……要坐这边吗？」","mes_example":"","creator_notes":"","system_prompt":"","post_history_instructions":"","alternate_greetings":[],"tags":["测试"],"creator":"","character_version":"","extensions":{}}}'
$chatLine1 = '{"name":"测试角色","is_user":false,"is_name":true,"create_date":"2025-08-01T10:00:00Z","mes":"风铃作响，她从书页间抬起头。","swipes":[]}'
$chatLine2 = '{"name":"测试者","is_user":true,"is_name":true,"create_date":"2025-08-01T10:01:00Z","mes":"我推门走进咖啡厅。","swipes":[]}'

[IO.File]::WriteAllText("$data\worlds\测试书.json", $worldJson, (New-Object System.Text.UTF8Encoding $false))
[IO.File]::WriteAllText("$data\characters\测试角色\character.json", $cardJson, (New-Object System.Text.UTF8Encoding $false))
[IO.File]::WriteAllText("$data\chats\测试角色\chat.jsonl", $chatLine1 + "`n" + $chatLine2 + "`n", (New-Object System.Text.UTF8Encoding $false))

Compress-Archive -Path "$data\*" -DestinationPath "$base\data.zip" -Force
Write-Host "data.zip: $((Get-Item "$base\data.zip").Length) bytes"

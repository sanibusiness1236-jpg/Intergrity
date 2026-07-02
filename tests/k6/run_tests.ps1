# INTEGRITY k6 Load Test Runner (PowerShell)
# ─────────────────────────────────────────────────────────────────────────────
# Prerequisites:
#   - k6 installed: https://k6.io/docs/get-started/installation/
#   - Set environment variables below before running
#
# Usage:
#   .\tests\k6\run_tests.ps1 -Scenario all -BaseUrl https://your-backend/api
#   .\tests\k6\run_tests.ps1 -Scenario login_storm
#   .\tests\k6\run_tests.ps1 -Scenario progressive
#
# Results are written to tests\k6\results\

param(
    [string]$Scenario    = "all",
    [string]$BaseUrl     = $env:K6_BASE_URL ?? "https://intergrity-backend.onrender.com/api",
    [string]$EmailDomain = $env:K6_EMAIL_DOMAIN ?? "loadtest.integrity.dev",
    [string]$Password    = $env:K6_PASSWORD ?? "TestPassword123!",
    [string]$ExamId      = $env:EXAM_ID ?? "replace-with-real-exam-uuid"
)

$ResultsDir = Join-Path $PSScriptRoot "results"
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

$CommonEnv = @(
    "--env", "K6_BASE_URL=$BaseUrl",
    "--env", "K6_EMAIL_DOMAIN=$EmailDomain",
    "--env", "K6_PASSWORD=$Password",
    "--env", "EXAM_ID=$ExamId"
)

function Run-Scenario {
    param([string]$Name, [string]$File)
    Write-Host "`n━━━ Running: $Name ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    $OutFile = Join-Path $ResultsDir "${Name}_${Timestamp}.json"
    k6 run @CommonEnv --out "json=$OutFile" --summary-export "$OutFile.summary.json" $File
    Write-Host "  Results → $OutFile" -ForegroundColor Green
}

switch ($Scenario.ToLower()) {
    "login_storm"   { Run-Scenario "login_storm"    "$PSScriptRoot\scenarios\01_login_storm.js" }
    "dashboard"     { Run-Scenario "dashboard_load" "$PSScriptRoot\scenarios\02_dashboard_load.js" }
    "exam_start"    { Run-Scenario "exam_start"     "$PSScriptRoot\scenarios\03_exam_start.js" }
    "autosave"      { Run-Scenario "autosave"       "$PSScriptRoot\scenarios\04_autosave.js" }
    "submit"        { Run-Scenario "exam_submit"    "$PSScriptRoot\scenarios\05_exam_submit.js" }
    "monitoring"    { Run-Scenario "live_monitor"   "$PSScriptRoot\scenarios\06_live_monitoring.js" }
    "full_flow"     { Run-Scenario "full_exam_flow" "$PSScriptRoot\scenarios\07_full_exam_flow.js" }
    "progressive"   { Run-Scenario "progressive"    "$PSScriptRoot\progressive_load_test.js" }
    "all" {
        Run-Scenario "login_storm"    "$PSScriptRoot\scenarios\01_login_storm.js"
        Run-Scenario "dashboard_load" "$PSScriptRoot\scenarios\02_dashboard_load.js"
        Run-Scenario "exam_start"     "$PSScriptRoot\scenarios\03_exam_start.js"
        Run-Scenario "autosave"       "$PSScriptRoot\scenarios\04_autosave.js"
        Run-Scenario "exam_submit"    "$PSScriptRoot\scenarios\05_exam_submit.js"
        Run-Scenario "live_monitor"   "$PSScriptRoot\scenarios\06_live_monitoring.js"
        Run-Scenario "full_exam_flow" "$PSScriptRoot\scenarios\07_full_exam_flow.js"
    }
    default { Write-Error "Unknown scenario: $Scenario" }
}

Write-Host "`n✓ All results saved to $ResultsDir" -ForegroundColor Green

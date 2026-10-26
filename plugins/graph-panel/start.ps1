$ErrorActionPreference = 'Stop'
try {
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        $nodePath = $bundledNode
    } else {
        $nodePath = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'server.mjs') + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $server = New-Object System.Diagnostics.Process
    $server.StartInfo = $startInfo
    [void]$server.Start()
    $outputTask = $server.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $errorTask = $server.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    $inputStream = [Console]::OpenStandardInput()
    $buffer = New-Object byte[] 8192
    while (($length = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $server.StandardInput.BaseStream.Write($buffer, 0, $length)
        $server.StandardInput.BaseStream.Flush()
    }
    $server.StandardInput.Close()
    $server.WaitForExit()
    $outputTask.GetAwaiter().GetResult()
    $errorTask.GetAwaiter().GetResult()
    exit $server.ExitCode
} catch {
    [Console]::Error.WriteLine('Graph Panel: ' + $_.Exception.Message)
    exit 1
}

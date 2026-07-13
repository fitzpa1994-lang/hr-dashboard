param(
  [Parameter(Position = 0)]
  [string]$ProtocolUri
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$SearchTimeoutSeconds = 20
$RecentScanLimitPerFolder = 600
$LogDir = Join-Path $env:LOCALAPPDATA 'SportonHR'
$LogPath = Join-Path $LogDir 'outlook-protocol.log'

function Write-Log([string]$Message) {
  try {
    if (-not (Test-Path -LiteralPath $LogDir)) {
      New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$stamp] $Message"
  } catch {}
}

function Show-Error([string]$Message) {
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, 'SPORTON Outlook', 'OK', 'Error') | Out-Null
  } catch {
    Write-Error $Message
  }
}

function Decode-QueryValue([string]$Value) {
  if ($null -eq $Value) { return '' }
  return [System.Uri]::UnescapeDataString($Value.Replace('+', ' '))
}

function Get-QueryParameters([string]$UriText) {
  $uri = [System.Uri]$UriText
  $query = $uri.Query.TrimStart('?')
  $params = @{}
  if (-not $query) { return $params }

  foreach ($part in $query.Split('&')) {
    if (-not $part) { continue }
    $pieces = $part.Split('=', 2)
    $key = Decode-QueryValue $pieces[0]
    $value = if ($pieces.Count -gt 1) { Decode-QueryValue $pieces[1] } else { '' }
    if ($key) { $params[$key] = $value }
  }
  return $params
}

function Normalize-Text([string]$Value) {
  if ($null -eq $Value) { return '' }
  return ($Value -replace '\s+', ' ').Trim()
}

function Escape-Dasl([string]$Value) {
  return $Value.Replace("'", "''")
}

function Get-MailFolders($Folder) {
  if ($null -eq $Folder) { return }
  try {
    if ($Folder.DefaultItemType -eq 0) { $Folder }
    foreach ($child in @($Folder.Folders)) {
      Get-MailFolders $child
    }
  } catch {}
}

function Get-ChildMailFolders($Folder, [int]$Depth) {
  if ($null -eq $Folder -or $Depth -le 0) { return }
  foreach ($child in @($Folder.Folders)) {
    try {
      if ($child.DefaultItemType -eq 0) { $child }
      Get-ChildMailFolders $child ($Depth - 1)
    } catch {}
  }
}

function Get-SearchFolders($Session) {
  $seen = @{}
  $folders = New-Object System.Collections.Generic.List[object]
  $defaultFolderIds = @(6, 5)

  foreach ($folderId in $defaultFolderIds) {
    try {
      $folder = $Session.GetDefaultFolder($folderId)
      if ($null -ne $folder -and -not $seen.ContainsKey($folder.EntryID)) {
        $seen[$folder.EntryID] = $true
        $folders.Add($folder)
      }
      foreach ($child in @(Get-ChildMailFolders $folder 1)) {
        if ($null -ne $child -and -not $seen.ContainsKey($child.EntryID)) {
          $seen[$child.EntryID] = $true
          $folders.Add($child)
        }
      }
    } catch {}
  }

  foreach ($store in @($Session.Stores)) {
    foreach ($folderId in $defaultFolderIds) {
      try {
        $folder = $store.GetDefaultFolder($folderId)
        if ($null -ne $folder -and -not $seen.ContainsKey($folder.EntryID)) {
          $seen[$folder.EntryID] = $true
          $folders.Add($folder)
        }
        foreach ($child in @(Get-ChildMailFolders $folder 1)) {
          if ($null -ne $child -and -not $seen.ContainsKey($child.EntryID)) {
            $seen[$child.EntryID] = $true
            $folders.Add($child)
          }
        }
      } catch {}
    }
  }

  return $folders
}

function Restrict-BySubject($Items, [string]$SubjectText) {
  if ([string]::IsNullOrWhiteSpace($SubjectText)) { return @() }
  $escapedSubject = Escape-Dasl $SubjectText
  $filter = "@SQL=""http://schemas.microsoft.com/mapi/proptag/0x0037001f"" = '$escapedSubject'"
  try {
    return @($Items.Restrict($filter))
  } catch {
    return @()
  }
}

function Score-Mail($Mail, [string]$SubjectText, [Nullable[datetime]]$ReceivedDate) {
  $score = 0
  $mailSubject = Normalize-Text ([string]$Mail.Subject)
  $targetSubject = Normalize-Text $SubjectText

  if ($targetSubject -and $mailSubject -eq $targetSubject) {
    $score += 1000
  } elseif ($targetSubject -and $mailSubject.Contains($targetSubject)) {
    $score += 500
  }

  if ($ReceivedDate.HasValue) {
    try {
      $minutes = [math]::Abs((([datetime]$Mail.ReceivedTime) - $ReceivedDate.Value).TotalMinutes)
      $score += [math]::Max(0, 300 - [int]$minutes)
    } catch {}
  }

  return $score
}

function Test-SearchDeadline([datetime]$Deadline) {
  if ((Get-Date) -gt $Deadline) {
    throw "Outlook search timed out after $SearchTimeoutSeconds seconds."
  }
}

function Find-BestMailInFolder($Folder, [string]$Subject, [Nullable[datetime]]$ReceivedAt, [datetime]$Deadline) {
  $bestMail = $null
  $bestScore = -1
  $items = $Folder.Items
  $items.Sort('[ReceivedTime]', $true)

  foreach ($mail in @(Restrict-BySubject $items $Subject)) {
    Test-SearchDeadline $Deadline
    if ($null -eq $mail) { continue }
    if ($mail.Class -ne 43) { continue }
    $score = Score-Mail $mail $Subject $ReceivedAt
    if ($score -gt $bestScore) {
      $bestScore = $score
      $bestMail = $mail
    }
  }

  if ($bestMail) {
    return @{ Mail = $bestMail; Score = $bestScore }
  }

  $max = [math]::Min([int]$items.Count, $RecentScanLimitPerFolder)
  for ($i = 1; $i -le $max; $i++) {
    Test-SearchDeadline $Deadline
    try {
      $mail = $items.Item($i)
      if ($null -eq $mail -or $mail.Class -ne 43) { continue }
      $mailSubject = Normalize-Text ([string]$mail.Subject)
      if (-not $mailSubject.Contains($Subject)) { continue }
      $score = Score-Mail $mail $Subject $ReceivedAt
      if ($score -gt $bestScore) {
        $bestScore = $score
        $bestMail = $mail
      }
    } catch {}
  }

  if ($bestMail) {
    return @{ Mail = $bestMail; Score = $bestScore }
  }

  return $null
}

function Open-OutlookMail([hashtable]$Params) {
  $messageId = Normalize-Text $Params.messageId
  $messageId = $messageId -replace '#\d+$', ''
  $subject = Normalize-Text $Params.subject
  $receivedAt = Normalize-Text $Params.receivedAt

  if ([string]::IsNullOrWhiteSpace($subject)) {
    throw 'Missing recommendation mail subject. Cannot search Outlook.'
  }

  $targetReceivedAt = $null
  if (-not [string]::IsNullOrWhiteSpace($receivedAt)) {
    try {
      $targetReceivedAt = [datetime]::Parse(
        $receivedAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeLocal
      )
    } catch {
      $targetReceivedAt = $null
    }
  }

  $outlook = New-Object -ComObject Outlook.Application
  $session = $outlook.Session
  $bestMail = $null
  $bestScore = -1
  $deadline = (Get-Date).AddSeconds($SearchTimeoutSeconds)
  $folders = @(Get-SearchFolders $session)

  Write-Log "Searching Outlook subject='$subject' receivedAt='$receivedAt' folders=$($folders.Count)"

  foreach ($folder in $folders) {
    Test-SearchDeadline $deadline
    try {
      Write-Log "Checking folder '$($folder.FolderPath)'"
      $result = Find-BestMailInFolder $folder $subject $targetReceivedAt $deadline
      if ($result -and $result.Score -gt $bestScore) {
        $bestScore = $result.Score
        $bestMail = $result.Mail
      }
      if ($bestScore -ge 1000) { break }
    } catch {
      Write-Log "Folder skipped: $($_.Exception.Message)"
    }
  }

  if ($null -eq $bestMail) {
    Write-Log "Mail not found subject='$subject'"
    throw "Outlook mail not found: $subject"
  }

  Write-Log "Opening mail subject='$($bestMail.Subject)' received='$($bestMail.ReceivedTime)' folder='$($bestMail.Parent.FolderPath)' score=$bestScore"
  $bestMail.Display($false)
  try { $bestMail.Activate() } catch {}
}

try {
  if ([string]::IsNullOrWhiteSpace($ProtocolUri)) {
    throw 'Missing sporton-outlook protocol URI.'
  }

  $params = Get-QueryParameters $ProtocolUri
  Write-Log "Protocol invoked"
  Open-OutlookMail $params
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  Show-Error ($_.Exception.Message)
  exit 1
}

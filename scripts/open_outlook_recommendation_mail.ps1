param(
  [Parameter(Position = 0)]
  [string]$ProtocolUri
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

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

  foreach ($store in @($session.Stores)) {
    try {
      $root = $store.GetRootFolder()
    } catch {
      continue
    }

    foreach ($folder in @(Get-MailFolders $root)) {
      try {
        $items = $folder.Items
        $items.Sort('[ReceivedTime]', $true)
        foreach ($mail in @(Restrict-BySubject $items $subject)) {
          if ($null -eq $mail) { continue }
          if ($mail.Class -ne 43) { continue }
          $score = Score-Mail $mail $subject $targetReceivedAt
          if ($score -gt $bestScore) {
            $bestScore = $score
            $bestMail = $mail
          }
        }
      } catch {}
    }
  }

  if ($null -eq $bestMail) {
    throw "Outlook mail not found: $subject"
  }

  $bestMail.Display($false)
  try { $bestMail.Activate() } catch {}
}

try {
  if ([string]::IsNullOrWhiteSpace($ProtocolUri)) {
    throw 'Missing sporton-outlook protocol URI.'
  }

  $params = Get-QueryParameters $ProtocolUri
  Open-OutlookMail $params
} catch {
  Show-Error ($_.Exception.Message)
  exit 1
}

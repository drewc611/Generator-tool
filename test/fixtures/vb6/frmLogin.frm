VERSION 5.00
Object = "{831FDD16-0C5C-11D2-A9FC-0000F8754DA1}#2.0#0"; "MSCOMCTL.OCX"
Begin VB.Form frmLogin 
   Caption         =   "Log in"
   ClientHeight    =   3900
   ClientLeft      =   60
   ClientTop       =   345
   ClientWidth     =   6000
   BeginProperty Font 
      Name            =   "MS Sans Serif"
      Size            =   8.25
      Charset         =   0
      Weight          =   400
      Underline       =   0   'False
      Italic          =   0   'False
      Strikethrough   =   0   'False
   EndProperty
   LinkTopic       =   "Form1"
   ScaleHeight     =   3900
   ScaleWidth      =   6000
   StartUpPosition =   3  'Windows Default
   Begin VB.Timer tmrIdle 
      Interval        =   60000
      Left            =   5400
      Top             =   3600
   End
   Begin MSComctlLib.ProgressBar prgLoad 
      Height          =   255
      Left            =   240
      TabIndex        =   9
      Top             =   3480
      Width           =   3300
      _ExtentX        =   5821
      _ExtentY        =   450
      _Version        =   393216
      Appearance      =   1
   End
   Begin VB.CommandButton cmdCancel 
      Cancel          =   -1  'True
      Caption         =   "Cancel"
      Height          =   375
      Left            =   4560
      TabIndex        =   7
      Top             =   3000
      Width           =   1200
   End
   Begin VB.CommandButton cmdSave 
      Caption         =   "&Save"
      Default         =   -1  'True
      Height          =   375
      Left            =   3240
      TabIndex        =   6
      Top             =   3000
      Width           =   1200
   End
   Begin VB.CommandButton cmdHelp 
      Caption         =   "&Help"
      Enabled         =   0   'False
      Height          =   375
      Left            =   240
      TabIndex        =   8
      Top             =   3000
      Width           =   1200
   End
   Begin VB.TextBox txtNotes 
      Height          =   200
      Left            =   1560
      Locked          =   -1  'True
      MultiLine       =   -1  'True
      TabIndex        =   14
      Text            =   "frmLogin.frx":0034
      Top             =   2760
      Width           =   4200
   End
   Begin VB.Label lblLocked 
      Caption         =   "Locked out"
      Height          =   255
      Left            =   240
      TabIndex        =   15
      Top             =   2760
      Visible         =   0   'False
      Width           =   1200
   End
   Begin VB.TextBox txtField 
      Height          =   285
      Index           =   1
      Left            =   3240
      TabIndex        =   5
      Top             =   2400
      Width           =   2500
   End
   Begin VB.TextBox txtField 
      Height          =   285
      Index           =   0
      Left            =   240
      TabIndex        =   4
      Top             =   2400
      Width           =   2500
   End
   Begin VB.CheckBox chkRemember 
      Caption         =   "&Remember me"
      Height          =   255
      Left            =   1560
      TabIndex        =   13
      Top             =   2100
      Width           =   2500
   End
   Begin VB.ComboBox cboRegion 
      Height          =   315
      ItemData        =   "frmLogin.frx":0000
      Left            =   1560
      List            =   "frmLogin.frx":000A
      Style           =   2  'Dropdown List
      TabIndex        =   3
      Top             =   1680
      Width           =   2500
   End
   Begin VB.Label lblRegion 
      Caption         =   "Region"
      Height          =   255
      Left            =   240
      TabIndex        =   11
      Top             =   1720
      Width           =   1200
   End
   Begin VB.Frame fraRole 
      Caption         =   "Role"
      Height          =   735
      Left            =   240
      TabIndex        =   10
      Top             =   840
      Width           =   5500
      Begin VB.OptionButton optManager 
         Caption         =   "&Manager"
         Height          =   255
         Left            =   2400
         TabIndex        =   2
         Top             =   300
         Width           =   1500
      End
      Begin VB.OptionButton optClerk 
         Caption         =   "&Clerk"
         Height          =   255
         Left            =   240
         TabIndex        =   1
         Top             =   300
         Value           =   -1  'True
         Width           =   1500
      End
   End
   Begin VB.TextBox txtPassword 
      Height          =   285
      IMEMode         =   3  'DISABLE
      Left            =   1560
      PasswordChar    =   "*"
      TabIndex        =   1
      Top             =   450
      Width           =   2500
   End
   Begin VB.TextBox txtUser 
      Height          =   285
      Left            =   1560
      TabIndex        =   0
      Top             =   90
      Width           =   2500
   End
   Begin VB.Image imgLogo 
      Height          =   600
      Left            =   4800
      Picture         =   "frmLogin.frx":0052
      Top             =   120
      Width           =   900
   End
   Begin VB.Label lblPassword 
      Caption         =   "Password:"
      Height          =   255
      Left            =   240
      TabIndex        =   12
      Top             =   480
      Width           =   1200
   End
   Begin VB.Label lblUser 
      Caption         =   "&User name:"
      Height          =   255
      Left            =   240
      TabIndex        =   16
      Top             =   120
      Width           =   1200
   End
   Begin VB.Menu mnuFile 
      Caption         =   "&File"
      Begin VB.Menu mnuOpen 
         Caption         =   "&Open..."
         Shortcut        =   ^O
      End
      Begin VB.Menu mnuSep 
         Caption         =   "-"
      End
      Begin VB.Menu mnuExit 
         Caption         =   "E&xit"
      End
   End
   Begin VB.Menu mnuHelp 
      Caption         =   "&Help"
      Begin VB.Menu mnuAbout 
         Caption         =   "&About"
         Enabled         =   0   'False
      End
   End
End
Attribute VB_Name = "frmLogin"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Option Explicit

Private Sub Form_Load()
    ' The region list comes from the database at start up
    cboRegion.AddItem "North"
End Sub

Private Sub cmdSave_Click()
    If txtUser.Text = "" Then
        MsgBox "Enter a user name.", vbExclamation, "Log in"
        Exit Sub
    End If
    MsgBox "Welcome, " & txtUser.Text & "!"
End Sub

Private Sub cmdCancel_Click()
    Unload Me
End Sub

Private Sub txtUser_Change()
    cmdSave.Enabled = Len(txtUser.Text) > 0
End Sub

Private Sub mnuOpen_Click()
    MsgBox ("Nothing to open."), vbInformation
End Sub

Private Sub txtField_LostFocus(Index As Integer)
    ' MsgBox "a comment is not a message"
End Sub

Private Sub tmrIdle_Timer()
    Unload Me
End Sub

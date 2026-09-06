VERSION 5.00
Begin VB.Form frmAbout 
   Caption         =   "About Ledger"
   ClientHeight    =   1500
   ClientWidth     =   3000
   Begin VB.CommandButton cmdClose 
      Cancel          =   -1  'True
      Caption         =   "Close"
      Height          =   375
      Left            =   1800
      TabIndex        =   0
      Top             =   1000
      Width           =   1000
   End
   Begin VB.Image imgLogo 
      Height          =   600
      Left            =   120
      Picture         =   "frmAbout.frx":0000
      Top             =   120
      Width           =   600
   End
   Begin VB.Label lblVersion 
      Caption         =   "Ledger 4.2"
      Height          =   255
      Left            =   900
      TabIndex        =   1
      Top             =   240
      Width           =   2000
   End
End
Attribute VB_Name = "frmAbout"
Option Explicit

Private Sub cmdClose_Click()
    Unload Me
End Sub

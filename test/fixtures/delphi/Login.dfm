object frmLogin: TfrmLogin
  Left = 0
  Top = 0
  Caption = 'Log in'
  ClientHeight = 330
  ClientWidth = 420
  Color = clBtnFace
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -11
  Font.Name = 'Tahoma'
  Font.Style = []
  Menu = mnuMain
  OldCreateOrder = False
  OnCreate = FormCreate
  PixelsPerInch = 96
  TextHeight = 13
  object lblUser: TLabel
    Left = 16
    Top = 16
    Width = 55
    Height = 13
    Caption = '&User name:'
    FocusControl = edtUser
  end
  object edtUser: TEdit
    Left = 104
    Top = 13
    Width = 200
    Height = 21
    TabOrder = 0
    OnChange = edtUserChange
  end
  object lblPassword: TLabel
    Left = 16
    Top = 44
    Width = 50
    Height = 13
    Caption = 'Password:'
  end
  object edtPassword: TEdit
    Left = 104
    Top = 41
    Width = 200
    Height = 21
    PasswordChar = '*'
    TabOrder = 1
  end
  object rgRole: TRadioGroup
    Left = 16
    Top = 72
    Width = 288
    Height = 49
    Caption = 'Role'
    ItemIndex = 0
    Items.Strings = (
      'Clerk'
      'Manager')
    TabOrder = 2
  end
  object grpShift: TGroupBox
    Left = 312
    Top = 72
    Width = 92
    Height = 49
    Caption = 'Shift'
    TabOrder = 3
    object rbDay: TRadioButton
      Left = 8
      Top = 16
      Width = 60
      Height = 17
      Caption = 'Day'
      Checked = True
      TabOrder = 0
      TabStop = True
    end
    object rbNight: TRadioButton
      Left = 8
      Top = 32
      Width = 60
      Height = 17
      Caption = 'Night'
      TabOrder = 1
    end
  end
  object lblRegion: TLabel
    Left = 16
    Top = 136
    Width = 33
    Height = 13
    Caption = 'Region'
  end
  object cbRegion: TComboBox
    Left = 104
    Top = 133
    Width = 200
    Height = 21
    Style = csDropDownList
    Items.Strings = (
      'North'
      'South'
      'It''s complicated')
    TabOrder = 4
  end
  object chkRemember: TCheckBox
    Left = 104
    Top = 164
    Width = 120
    Height = 17
    Caption = '&Remember me'
    Checked = True
    State = cbChecked
    TabOrder = 5
  end
  object pgOptions: TPageControl
    Left = 16
    Top = 190
    Width = 388
    Height = 60
    ActivePage = tsNotes
    TabOrder = 6
    object tsNotes: TTabSheet
      Caption = 'Notes'
      object memNotes: TMemo
        Left = 3
        Top = 3
        Width = 370
        Height = 30
        Lines.Strings = (
          'Line one'
          'Line two')
        ReadOnly = True
        TabOrder = 0
      end
    end
    object tsExtra: TTabSheet
      Caption = 'Extra'
      ImageIndex = 1
      object spnCount: TSpinEdit
        Left = 3
        Top = 3
        Width = 60
        Height = 22
        MaxValue = 0
        MinValue = 0
        TabOrder = 0
        Value = 0
      end
      object trkLevel: TTrackBar
        Left = 80
        Top = 3
        Width = 100
        Height = 25
        TabOrder = 1
      end
      object dtpSince: TDateTimePicker
        Left = 190
        Top = 3
        Width = 100
        Height = 21
        Date = 44927.000000000000000000
        Time = 0.500000000000000000
        TabOrder = 2
      end
    end
  end
  object lblLocked: TLabel
    Left = 16
    Top = 256
    Width = 50
    Height = 13
    Caption = 'Locked' + #32 +
      'out'
    Visible = False
  end
  object grdUsers: TDBGrid
    Left = 104
    Top = 256
    Width = 300
    Height = 30
    DataSource = dsUsers
    TabOrder = 7
    TitleFont.Charset = DEFAULT_CHARSET
    TitleFont.Name = 'Tahoma'
    Columns = <
      item
        Expanded = False
        FieldName = 'name'
        Title.Caption = 'Name'
        Width = 120
        Visible = True
      end
      item
        Expanded = False
        FieldName = 'active'
        Visible = True
      end>
  end
  object btnHelp: TButton
    Left = 16
    Top = 296
    Width = 75
    Height = 25
    Caption = '&Help'
    Enabled = False
    TabOrder = 8
  end
  object btnSave: TBitBtn
    Left = 240
    Top = 296
    Width = 75
    Height = 25
    Caption = '&Save'
    Default = True
    ModalResult = 1
    TabOrder = 9
    OnClick = btnSaveClick
  end
  object btnCancel: TButton
    Left = 329
    Top = 296
    Width = 75
    Height = 25
    Cancel = True
    Caption = 'Cancel'
    ModalResult = 2
    TabOrder = 10
  end
  object imgLogo: TImage
    Left = 320
    Top = 8
    Width = 84
    Height = 60
    Picture.Data = {
      07544269746D617036030000424D36030000000000003600000028000000
      1000000010000000010018000000000000030000C40E0000C40E0000000000
      00000000}
  end
  object mnuMain: TMainMenu
    Left = 360
    Top = 120
    object mnuFile: TMenuItem
      Caption = '&File'
      object mnuOpen: TMenuItem
        Caption = '&Open...'
        ShortCut = 16463
        OnClick = mnuOpenClick
      end
      object N1: TMenuItem
        Caption = '-'
      end
      object mnuExit: TMenuItem
        Caption = 'E&xit'
        OnClick = mnuExitClick
      end
    end
    object mnuHelp: TMenuItem
      Caption = '&Help'
      object mnuAbout: TMenuItem
        Caption = '&About'
        Enabled = False
      end
    end
  end
  object dsUsers: TDataSource
    DataSet = qryUsers
    Left = 360
    Top = 160
  end
  object qryUsers: TQuery
    DatabaseName = 'Ledger'
    SQL.Strings = (
      'select id, name, secret_token'
      'from users'
      'where active = 1')
    Left = 392
    Top = 160
  end
  object tmrIdle: TTimer
    Interval = 60000
    OnTimer = tmrIdleTimer
    Left = 360
    Top = 200
  end
end

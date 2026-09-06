$PBExportHeader$w_login.srw
forward
global type w_login from window
end type
type st_1 from statictext within w_login
end type
type sle_username from singlelineedit within w_login
end type
type sle_password from singlelineedit within w_login
end type
type cbx_remember from checkbox within w_login
end type
type ddlb_role from dropdownlistbox within w_login
end type
type cb_login from commandbutton within w_login
end type
end forward

global type w_login from window
integer width = 2000
integer height = 1200
string title = "Sign in"
st_1 st_1
sle_username sle_username
sle_password sle_password
cbx_remember cbx_remember
ddlb_role ddlb_role
cb_login cb_login
end type
global w_login w_login

on w_login.create
this.st_1 = create st_1
this.sle_username = create sle_username
this.sle_password = create sle_password
this.cbx_remember = create cbx_remember
this.ddlb_role = create ddlb_role
this.cb_login = create cb_login
end on

on w_login.destroy
destroy(this.st_1)
destroy(this.sle_username)
end on

type variables
string is_lastuser
end variables

type st_1 from statictext within w_login
integer x = 46
integer y = 40
integer width = 320
integer height = 60
string text = "Username"
end type

type sle_username from singlelineedit within w_login
integer x = 46
integer y = 120
integer width = 480
integer height = 80
end type

type sle_password from singlelineedit within w_login
integer x = 46
integer y = 220
integer width = 480
integer height = 80
boolean password = true
end type

type cbx_remember from checkbox within w_login
integer x = 46
integer y = 320
string text = "Remember me"
end type

type ddlb_role from dropdownlistbox within w_login
integer x = 46
integer y = 420
string item[] = {"Administrator","User"}
end type

type cb_login from commandbutton within w_login
integer x = 46
integer y = 520
string text = "Login"
end type

event cb_login::clicked;
string ls_user
ls_user = sle_username.text
if IsNull(ls_user) then return
parent.triggerevent("ue_login")
end event

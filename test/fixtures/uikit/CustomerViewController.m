#import "CustomerViewController.h"

@implementation CustomerViewController

- (void)viewDidLoad {
    [super viewDidLoad];

    UILabel *custNoLabel = [[UILabel alloc] initWithFrame:CGRectMake(10, 10, 80, 20)];
    custNoLabel.text = @"Cust No:";
    [self.view addSubview:custNoLabel];

    UITextField *custNoField = [[UITextField alloc] initWithFrame:CGRectMake(100, 10, 200, 20)];
    [self.view addSubview:custNoField];

    // a computed caption, not a plain string literal: named rather than guessed
    UILabel *nameLabel = [[UILabel alloc] initWithFrame:CGRectMake(10, 40, 80, 20)];
    nameLabel.text = [self computedNameLabel];
    [self.view addSubview:nameLabel];

    // a bare field, never assigned to anything: a real gap, named rather than invented
    [[UITextField alloc] initWithFrame:CGRectMake(100, 70, 200, 20)];

    UILabel *passwordLabel = [[UILabel alloc] initWithFrame:CGRectMake(10, 100, 80, 20)];
    [passwordLabel setText:@"Password:"];
    [self.view addSubview:passwordLabel];

    UITextField *passwordField = [[UITextField alloc] initWithFrame:CGRectMake(100, 100, 200, 20)];
    passwordField.secureTextEntry = YES;
    [self.view addSubview:passwordField];

    UISwitch *activeSwitch = [[UISwitch alloc] initWithFrame:CGRectMake(10, 130, 50, 30)];
    [self.view addSubview:activeSwitch];

    UITextView *notesView = [[UITextView alloc] initWithFrame:CGRectMake(10, 170, 300, 80)];
    [self.view addSubview:notesView];

    UIButton *okButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [okButton setTitle:@"OK" forState:UIControlStateNormal];
    [okButton addTarget:self action:@selector(handleOk) forControlEvents:UIControlEventTouchUpInside];
    [self.view addSubview:okButton];

    UIButton *cancelButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [cancelButton setTitle:@"Cancel" forState:UIControlStateNormal];
    [self.view addSubview:cancelButton];
}

- (NSString *)computedNameLabel {
    return [NSString stringWithFormat:@"Name %d:", 1];
}

@end

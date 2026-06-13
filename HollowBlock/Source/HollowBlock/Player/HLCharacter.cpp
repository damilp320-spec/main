// Copyright Hollow Block. All Rights Reserved.

#include "Player/HLCharacter.h"

#include "HollowBlock.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/HLFlashlightComponent.h"
#include "Components/HLComposureComponent.h"
#include "Interaction/HLInteractableInterface.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"

AHLCharacter::AHLCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	GetCapsuleComponent()->InitCapsuleSize(34.f, 88.f);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(GetCapsuleComponent());
	Camera->SetRelativeLocation(FVector(0.f, 0.f, 64.f));
	Camera->bUsePawnControlRotation = true;

	FlashlightLight = CreateDefaultSubobject<USpotLightComponent>(TEXT("FlashlightLight"));
	FlashlightLight->SetupAttachment(Camera);
	FlashlightLight->SetIntensity(0.f);
	FlashlightLight->SetVisibility(false);
	FlashlightLight->SetOuterConeAngle(28.f);
	FlashlightLight->SetInnerConeAngle(12.f);
	FlashlightLight->SetAttenuationRadius(2200.f);

	Flashlight = CreateDefaultSubobject<UHLFlashlightComponent>(TEXT("Flashlight"));
	Composure = CreateDefaultSubobject<UHLComposureComponent>(TEXT("Composure"));

	UCharacterMovementComponent* MoveComp = GetCharacterMovement();
	MoveComp->MaxWalkSpeed = WalkSpeed;
	MoveComp->MaxWalkSpeedCrouched = CrouchSpeed;
	MoveComp->NavAgentProps.bCanCrouch = true;
	MoveComp->bCanWalkOffLedgesWhenCrouching = true;

	bUseControllerRotationYaw = true;
}

void AHLCharacter::BeginPlay()
{
	Super::BeginPlay();

	Stamina = MaxStaminaSeconds;

	if (Flashlight)
	{
		Flashlight->SetControlledLight(FlashlightLight);
	}

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DefaultMappingContext)
			{
				Subsystem->AddMappingContext(DefaultMappingContext, 0);
			}
			else
			{
				UE_LOG(LogHollowBlock, Warning, TEXT("HLCharacter has no DefaultMappingContext assigned; input will not work."));
			}
		}
	}
}

void AHLCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!EIC)
	{
		UE_LOG(LogHollowBlock, Error, TEXT("HLCharacter requires an EnhancedInputComponent. Set it as the default in project settings."));
		return;
	}

	if (MoveAction)
	{
		EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AHLCharacter::Move);
	}
	if (LookAction)
	{
		EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AHLCharacter::Look);
	}
	if (SprintAction)
	{
		EIC->BindAction(SprintAction, ETriggerEvent::Started, this, &AHLCharacter::StartSprint);
		EIC->BindAction(SprintAction, ETriggerEvent::Completed, this, &AHLCharacter::StopSprint);
	}
	if (CrouchAction)
	{
		EIC->BindAction(CrouchAction, ETriggerEvent::Started, this, &AHLCharacter::ToggleCrouch);
	}
	if (InteractAction)
	{
		EIC->BindAction(InteractAction, ETriggerEvent::Started, this, &AHLCharacter::OnInteract);
	}
	if (FlashlightAction)
	{
		EIC->BindAction(FlashlightAction, ETriggerEvent::Started, this, &AHLCharacter::OnToggleFlashlight);
	}
}

void AHLCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UpdateStamina(DeltaSeconds);
	UpdateInteractionProbe();
	UpdateDarkness();
}

void AHLCharacter::Move(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	if (Controller && !Axis.IsNearlyZero())
	{
		const FRotator YawRotation(0.f, Controller->GetControlRotation().Yaw, 0.f);
		const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
		const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);
		AddMovementInput(Forward, Axis.Y);
		AddMovementInput(Right, Axis.X);
	}
}

void AHLCharacter::Look(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddControllerYawInput(Axis.X);
	AddControllerPitchInput(Axis.Y);
}

void AHLCharacter::StartSprint()
{
	bWantsToSprint = true;
}

void AHLCharacter::StopSprint()
{
	bWantsToSprint = false;
}

void AHLCharacter::ToggleCrouch()
{
	if (bIsCrouched)
	{
		UnCrouch();
	}
	else
	{
		Crouch();
	}
}

void AHLCharacter::OnInteract()
{
	if (!FocusedActor)
	{
		return;
	}

	if (FocusedActor->Implements<UHLInteractableInterface>())
	{
		if (IHLInteractableInterface::Execute_CanInteract(FocusedActor, this))
		{
			IHLInteractableInterface::Execute_Interact(FocusedActor, this);
		}
	}
}

void AHLCharacter::OnToggleFlashlight()
{
	if (Flashlight)
	{
		Flashlight->ToggleFlashlight();
	}
}

void AHLCharacter::AddKey(FName KeyTag)
{
	if (!KeyTag.IsNone())
	{
		CollectedKeys.Add(KeyTag);
	}
}

void AHLCharacter::UpdateStamina(float DeltaSeconds)
{
	const bool bMoving = GetVelocity().SizeSquared2D() > 100.f;
	const bool bSprinting = bWantsToSprint && bMoving && !bIsCrouched && Stamina > 0.f;

	if (bSprinting)
	{
		Stamina = FMath::Max(0.f, Stamina - DeltaSeconds);
	}
	else
	{
		Stamina = FMath::Min(MaxStaminaSeconds, Stamina + StaminaRecoveryPerSecond * DeltaSeconds);
	}

	UCharacterMovementComponent* MoveComp = GetCharacterMovement();
	if (bIsCrouched)
	{
		MoveComp->MaxWalkSpeed = CrouchSpeed;
	}
	else
	{
		MoveComp->MaxWalkSpeed = bSprinting ? SprintSpeed : WalkSpeed;
	}
}

void AHLCharacter::UpdateInteractionProbe()
{
	AActor* NewFocus = nullptr;

	if (Camera)
	{
		const FVector Start = Camera->GetComponentLocation();
		const FVector End = Start + Camera->GetForwardVector() * InteractionDistance;

		FHitResult Hit;
		FCollisionQueryParams Params;
		Params.AddIgnoredActor(this);

		if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
		{
			AActor* HitActor = Hit.GetActor();
			if (HitActor && HitActor->Implements<UHLInteractableInterface>())
			{
				NewFocus = HitActor;
			}
		}
	}

	FocusedActor = NewFocus;
}

void AHLCharacter::UpdateDarkness()
{
	if (!Composure)
	{
		return;
	}

	// Approximate the player's exposure to light: if the flashlight is on and
	// pointing into the world it counts as lit; otherwise rely on whether the
	// character recently passed a darkness probe. Designers can refine this with
	// post-process light sampling, but this gives gameplay-meaningful behavior.
	const bool bLit = IsFlashlightIlluminatingSelf();
	Composure->SetInDarkness(!bLit);
}

bool AHLCharacter::IsFlashlightIlluminatingSelf() const
{
	return Flashlight && Flashlight->IsOn();
}
